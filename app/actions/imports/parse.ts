'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { imports, importLines, institutions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { downloadImportFile } from '@/lib/imports/storage';
import { resolveParser } from '@/lib/imports/parsers/registry';
import { runParser, LlmError } from '@/lib/imports/llm';
import type { ParsedTxLine } from '@/lib/imports/parsers/types';
import { suggestCategoryForDescription } from '@/lib/imports/category-suggest';
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
    })
    .from(imports)
    .leftJoin(institutions, eq(institutions.id, imports.institutionId))
    .where(and(eq(imports.id, importId), eq(imports.householdId, session.householdId)))
    .limit(1);

  if (!row) return { ok: false, error: 'not_found' };
  if (row.status !== 'uploaded' && row.status !== 'error') {
    return { ok: false, error: 'invalid_state' };
  }
  if (!row.fileUrl) return { ok: false, error: 'no_file' };
  if (!row.institutionName) {
    return { ok: false, error: 'no_parser', message: 'institución no encontrada' };
  }

  const parser = resolveParser(row.institutionName, row.type);
  if (!parser) {
    return {
      ok: false,
      error: 'no_parser',
      message: `parser no implementado para ${row.institutionName}/${row.type}`,
    };
  }

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

  const env = getServerEnv();
  const modelId = env.IMPORT_PARSER_MODEL_DEFAULT;

  // Dispatch por extensión real del archivo: pdf → document block, csv → text block.
  const isCsv = row.fileUrl.toLowerCase().endsWith('.csv');

  let result;
  try {
    if (isCsv) {
      result = await runParser({
        modelId,
        systemPrompt: parser.systemPrompt,
        userPrompt: parser.userPrompt,
        file: { kind: 'text', text: new TextDecoder().decode(bytes) },
        outputSchema: parser.schema,
      });
    } else {
      result = await runParser({
        modelId,
        systemPrompt: parser.systemPrompt,
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

  const lines = result.data.lines as ParsedTxLine[];

  // Sugerencia de categoría por línea (match exacto vs histórico).
  const lineRows = await Promise.all(
    lines.map(async (line) => {
      const proposedCategoryId = await suggestCategoryForDescription(
        session.householdId,
        line.description,
      );
      return {
        importId,
        rawData: line,
        parsedData: line,
        proposedCategoryId,
        status: 'pending' as const,
      };
    }),
  );

  if (lineRows.length > 0) {
    await db.insert(importLines).values(lineRows);
  }

  await db
    .update(imports)
    .set({
      status: 'parsed',
      parserModel: result.model,
      transactionCount: lineRows.length,
      errorMessage: null,
    })
    .where(and(eq(imports.id, importId), eq(imports.householdId, session.householdId)));

  revalidatePath(`/imports/${importId}`);
  revalidatePath('/imports');
  return { ok: true, lineCount: lineRows.length };
}
