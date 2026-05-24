'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, imports, importLines, institutions, transactions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { downloadImportFile } from '@/lib/imports/storage';
import { resolveParser } from '@/lib/imports/parsers/registry';
import { runParser, LlmError } from '@/lib/imports/llm';
import type { ParsedTxLine } from '@/lib/imports/parsers/types';
import { suggestCategoryForDescription } from '@/lib/imports/category-suggest';
import { loadCategoryTree } from '@/lib/categories/tree';
import { buildCategoryPromptBlock } from '@/lib/imports/parsers/category-prompt';
import { detectTransfers } from '@/lib/imports/detect-transfers';
import { getServerEnv } from '@/lib/env';

export type ParseImportResult =
  | { ok: true; lineCount: number }
  | {
      ok: false;
      error:
        | 'session'
        | 'not_found'
        | 'invalid_state'
        | 'no_parser'
        | 'no_file'
        | 'llm'
        | 'unknown';
      message?: string;
    };

export async function parseImport(importId: string): Promise<ParseImportResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const db = getDb();

  const [row] = await db
    .select({
      id: imports.id,
      type: imports.type,
      status: imports.status,
      fileUrl: imports.fileUrl,
      institutionId: imports.institutionId,
      institutionName: institutions.name,
      pdfPassword: institutions.pdfPassword,
      accountId: imports.accountId,
      accountName: accounts.name,
    })
    .from(imports)
    .leftJoin(institutions, eq(institutions.id, imports.institutionId))
    .leftJoin(accounts, eq(accounts.id, imports.accountId))
    .where(and(eq(imports.id, importId), eq(imports.householdId, session.householdId)))
    .limit(1);

  if (!row) return { ok: false, error: 'not_found' };
  const reparseable = ['uploaded', 'error', 'parsed', 'reviewing'];
  if (!reparseable.includes(row.status)) {
    return { ok: false, error: 'invalid_state' };
  }
  if (!row.fileUrl) return { ok: false, error: 'no_file' };
  if (!row.institutionName) {
    return { ok: false, error: 'no_parser', message: 'institución no encontrada' };
  }

  const parser = resolveParser(row.institutionName, row.type, row.accountName ?? undefined);
  if (!parser) {
    return {
      ok: false,
      error: 'no_parser',
      message: `parser no implementado para ${row.institutionName}/${row.type}`,
    };
  }

  // Re-parse: borrar import_lines que no tienen transacción vinculada (las
  // confirmadas se preservan). Esto permite re-parsear sin duplicar líneas.
  await db
    .delete(importLines)
    .where(and(eq(importLines.importId, importId), isNull(importLines.transactionId)));

  // status → parsing
  await db
    .update(imports)
    .set({ status: 'parsing', errorMessage: null })
    .where(and(eq(imports.id, importId), eq(imports.householdId, session.householdId)));
  revalidatePath(`/imports/${importId}`);

  let bytes: Uint8Array;
  try {
    bytes = await downloadImportFile(row.fileUrl);
  } catch {
    console.error('[imports] download failed', { importId });
    await db
      .update(imports)
      .set({ status: 'error', errorMessage: 'No se pudo bajar el archivo de Storage' })
      .where(and(eq(imports.id, importId), eq(imports.householdId, session.householdId)));
    return { ok: false, error: 'unknown' };
  }

  // Desbloquear PDF protegido con contraseña si la institución tiene una configurada.
  const isPdf = !row.fileUrl.toLowerCase().endsWith('.csv');
  if (isPdf && row.pdfPassword) {
    try {
      const { decryptPDF } = await import('@pdfsmaller/pdf-decrypt');
      const decrypted = await decryptPDF(bytes, row.pdfPassword);
      bytes = new Uint8Array(decrypted);
    } catch (err) {
      console.error('[imports] pdf unlock failed', { importId });
      await db
        .update(imports)
        .set({ status: 'error', errorMessage: 'No se pudo desbloquear el PDF. Verificá la contraseña en la institución.' })
        .where(and(eq(imports.id, importId), eq(imports.householdId, session.householdId)));
      return { ok: false, error: 'unknown', message: `PDF protegido: ${(err as Error).message?.slice(0, 100)}` };
    }
  }

  const env = getServerEnv();
  const modelId = env.IMPORT_PARSER_MODEL_DEFAULT;

  // Enriquecer prompt con categorías del household para sugerencia del LLM.
  const tree = await loadCategoryTree(session.householdId);
  const categoryBlock = buildCategoryPromptBlock(tree);
  const enrichedSystemPrompt = parser.systemPrompt + '\n\n' + categoryBlock;

  // Dispatch por extensión real del archivo: pdf → document block, csv → text block.
  const isCsv = !isPdf;

  let result;
  try {
    if (isCsv) {
      result = await runParser({
        modelId,
        systemPrompt: enrichedSystemPrompt,
        userPrompt: parser.userPrompt,
        file: { kind: 'text', text: new TextDecoder().decode(bytes) },
        outputSchema: parser.schema,
      });
    } else {
      result = await runParser({
        modelId,
        systemPrompt: enrichedSystemPrompt,
        userPrompt: parser.userPrompt,
        file: { kind: 'pdf', base64: Buffer.from(bytes).toString('base64') },
        outputSchema: parser.schema,
      });
    }
  } catch (err) {
    const msg =
      err instanceof LlmError
        ? `LLM ${err.code}: ${err.message.slice(0, 240)}`
        : 'LLM falló';
    console.error('[imports] llm failed', { importId, code: err instanceof LlmError ? err.code : 'unknown' });
    await db
      .update(imports)
      .set({ status: 'error', errorMessage: msg })
      .where(and(eq(imports.id, importId), eq(imports.householdId, session.householdId)));
    return { ok: false, error: 'llm', message: msg };
  }

  const allLines = result.data.lines as (ParsedTxLine & { suggestedCategory?: string })[];

  // Dedup: cargar descripciones de líneas ya confirmadas (con transaction_id)
  // para no reinsertar duplicadas al re-parsear.
  const confirmedRows = await db
    .select({ desc: sql<string>`${importLines.parsedData}->>'description'` })
    .from(importLines)
    .where(and(eq(importLines.importId, importId), isNotNull(importLines.transactionId)));
  const confirmedDescs = new Set(confirmedRows.map((r) => r.desc?.toLowerCase()));

  const filteredLines = allLines.filter(
    (line) => !confirmedDescs.has(line.description.toLowerCase()),
  );

  // Auto-detect transfers for banco imports (post-parse pass)
  const lines = row.type === 'banco' ? detectTransfers(filteredLines) : filteredLines;

  // Dedup cross-import: buscar transacciones existentes con misma cuenta,
  // fecha, descripción y monto que ya estén en la DB (de otro import u otra carga).
  const accountId = row.accountId;
  const existingTxKeys = new Set<string>();
  if (accountId && lines.length > 0) {
    const dates = lines.map((l) => l.date).filter(Boolean);
    const minDate = dates.reduce((a, b) => (a < b ? a : b));
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));
    const existingTxs = await db
      .select({
        date: transactions.date,
        description: transactions.description,
        amount: transactions.amountOriginal,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, session.householdId),
          eq(transactions.accountId, accountId),
          sql`${transactions.date} >= ${minDate}`,
          sql`${transactions.date} <= ${maxDate}`,
        ),
      );
    for (const tx of existingTxs) {
      existingTxKeys.add(`${tx.date}|${tx.description?.toLowerCase()}|${tx.amount}`);
    }
  }

  // Mapa nombre→id para resolver sugerencias del LLM (case-insensitive).
  const catByName = new Map(
    tree.map((c) => [c.name.toLowerCase(), c.id]),
  );

  // Sugerencia de categoría por línea:
  // 1) Match histórico (exacto/normalizado contra transactions + import_lines)
  // 2) Sugerencia del LLM (si devolvió suggestedCategory con nombre válido)
  // 3) null
  const lineRows = await Promise.all(
    lines.map(async (line) => {
      let proposedCategoryId = await suggestCategoryForDescription(
        session.householdId,
        line.description,
      );

      // Fallback: sugerencia del LLM
      if (!proposedCategoryId && line.suggestedCategory) {
        proposedCategoryId = catByName.get(line.suggestedCategory.toLowerCase()) ?? null;
      }

      // Auto-reject if this line already exists as a transaction (cross-import dedup)
      const lineKey = `${line.date}|${line.description.toLowerCase()}|${line.amountOriginal}`;
      const isDuplicate = existingTxKeys.has(lineKey);

      return {
        importId,
        rawData: line,
        parsedData: isDuplicate
          ? { ...line, notes: `[DUPLICADA] Ya existe como transacción en esta cuenta` }
          : line,
        proposedCategoryId,
        status: isDuplicate ? ('rejected' as const) : ('pending' as const),
      };
    }),
  );

  if (lineRows.length > 0) {
    await db.insert(importLines).values(lineRows);
  }

  const dupCount = lineRows.filter((l) => l.status === 'rejected').length;
  const pendingCount = lineRows.filter((l) => l.status === 'pending').length;

  // Extract summary from parser output (subtotals from the PDF)
  const summary = (result.data as { summary?: { totalExpense?: string; totalIncome?: string; currency?: string } }).summary ?? null;

  await db
    .update(imports)
    .set({
      status: 'parsed',
      parserModel: result.model,
      transactionCount: confirmedDescs.size + lineRows.length,
      summary,
      errorMessage: dupCount > 0
        ? `${dupCount} líneas duplicadas rechazadas automáticamente (ya existen como transacciones). ${pendingCount} pendientes de revisión.`
        : null,
    })
    .where(and(eq(imports.id, importId), eq(imports.householdId, session.householdId)));

  revalidatePath(`/imports/${importId}`);
  revalidatePath('/imports');
  return { ok: true, lineCount: lineRows.length };
}
