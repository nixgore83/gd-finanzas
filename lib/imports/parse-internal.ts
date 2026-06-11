import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { accounts, imports, importLines, institutions, transactions } from '@/db/schema';
import { downloadImportFile } from '@/lib/imports/storage';
import { readXlsxRows } from '@/lib/imports/xlsx';
import { resolveParser } from '@/lib/imports/parsers/registry';
import { runParser, LlmError } from '@/lib/imports/llm';
import { CsvFormatError, type ParsedTxLine, type ParserOutput } from '@/lib/imports/parsers/types';
import { suggestCategoryForDescription } from '@/lib/imports/category-suggest';
import {
  counterpartyHasIdentity,
  enrichLineWithHistory,
  lookupCounterpartyHistory,
  type CounterpartyHistory,
} from '@/lib/imports/counterparty-suggest';
import { loadCategoryTree } from '@/lib/categories/tree';
import { buildCategoryPromptBlock } from '@/lib/imports/parsers/category-prompt';
import { detectTransfers } from '@/lib/imports/detect-transfers';
import { matchAccountByRefs } from '@/lib/imports/counterparty-identity';
import { computeImportPeriod } from '@/lib/imports/period';
import { formatAccount } from '@/lib/accounts/format';
import { getServerEnv } from '@/lib/env';

export type ParseImportInternalResult =
  | { ok: true; lineCount: number }
  | {
      ok: false;
      error: 'not_found' | 'invalid_state' | 'no_parser' | 'no_file' | 'llm' | 'unknown';
      message?: string;
    };

/**
 * Core parsing logic without session requirement.
 * Used by both the server action (with session) and the cron (without session).
 */
export async function parseImportInternal(
  importId: string,
  householdId: string,
  customPassword?: string,
  persistPassword?: boolean,
): Promise<ParseImportInternalResult> {
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
      accountPdfPassword: accounts.pdfPassword,
      accountId: imports.accountId,
      accountName: accounts.name,
      accountCurrency: accounts.currencyDefault,
      accountOwnerTag: accounts.ownerTag,
    })
    .from(imports)
    .leftJoin(institutions, eq(institutions.id, imports.institutionId))
    .leftJoin(accounts, eq(accounts.id, imports.accountId))
    .where(and(eq(imports.id, importId), eq(imports.householdId, householdId)))
    .limit(1);

  if (!row) return { ok: false, error: 'not_found' };
  // 'parsing' DEBE estar incluido: el parseo async (`parseImport`/`parseImportSync`)
  // marca status='parsing' ANTES de invocar a parseImportInternal (para feedback en
  // la UI), así que al llegar acá el estado ya es 'parsing'. Sin esto, todo parse
  // disparado por esa vía devolvía 'invalid_state' y quedaba colgado en 'parsing'
  // (el cron de Gmail no, porque llama a parseImportInternal directo). También
  // permite reintentar un import realmente trabado en 'parsing'.
  const reparseable = ['uploaded', 'parsing', 'error', 'parsed', 'reviewing'];
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

  // Re-parse: delete unlinked import_lines
  await db
    .delete(importLines)
    .where(and(eq(importLines.importId, importId), isNull(importLines.transactionId)));

  // status → parsing (+ timestamp para detectar parseos cortados / stale)
  await db
    .update(imports)
    .set({ status: 'parsing', parsingStartedAt: sql`now()`, errorMessage: null })
    .where(and(eq(imports.id, importId), eq(imports.householdId, householdId)));

  let bytes: Uint8Array;
  try {
    bytes = await downloadImportFile(row.fileUrl);
  } catch {
    console.error('[imports] download failed', { importId });
    await db
      .update(imports)
      .set({ status: 'error', errorMessage: 'No se pudo bajar el archivo de Storage' })
      .where(and(eq(imports.id, importId), eq(imports.householdId, householdId)));
    return { ok: false, error: 'unknown' };
  }

  // Tipo de archivo (por extensión del path en Storage).
  const lowerUrl = row.fileUrl.toLowerCase();
  const ext: 'csv' | 'xlsx' | 'pdf' = lowerUrl.endsWith('.csv')
    ? 'csv'
    : lowerUrl.endsWith('.xlsx')
      ? 'xlsx'
      : 'pdf';

  // Unlock protected PDF
  const isPdf = ext === 'pdf';
  const pdfPassword = customPassword || row.accountPdfPassword || row.pdfPassword;
  if (isPdf && pdfPassword) {
    try {
      const { decryptPDF } = await import('@pdfsmaller/pdf-decrypt');
      const decrypted = await decryptPDF(bytes, pdfPassword);
      bytes = new Uint8Array(decrypted);

      // Si la desencriptación fue exitosa y vino un password manual, persistirlo
      if (customPassword && persistPassword) {
        if (row.accountId) {
          await db
            .update(accounts)
            .set({ pdfPassword: customPassword })
            .where(eq(accounts.id, row.accountId));
        } else if (row.institutionId) {
          await db
            .update(institutions)
            .set({ pdfPassword: customPassword })
            .where(eq(institutions.id, row.institutionId));
        }
      }
    } catch (err) {
      // Un PDF sin encriptar + contraseña (guardada o manual) no es un error:
      // no hay nada que desencriptar, seguimos con los bytes originales.
      const errMsg = (err as Error).message ?? '';
      const notEncrypted =
        /not encrypted/i.test(errMsg) || /No \/Encrypt dictionary/i.test(errMsg);
      if (!notEncrypted) {
        console.error('[imports] pdf unlock failed', { importId });
        await db
          .update(imports)
          .set({
            status: 'error',
            errorMessage:
              'No se pudo desbloquear el PDF. Verificá la contraseña en la institución o cuenta.',
          })
          .where(and(eq(imports.id, importId), eq(imports.householdId, householdId)));
        return {
          ok: false,
          error: 'unknown',
          message: `PDF protegido: ${errMsg.slice(0, 100)}`,
        };
      }
    }
  }

  const env = getServerEnv();
  const modelId = env.IMPORT_PARSER_MODEL_DEFAULT;

  const tree = await loadCategoryTree(householdId);
  const categoryBlock = buildCategoryPromptBlock(tree);
  const enrichedSystemPrompt = parser.systemPrompt + '\n\n' + categoryBlock;

  const isCsv = ext === 'csv';
  const isXlsx = ext === 'xlsx';
  const currency: 'ARS' | 'USD' = row.accountCurrency === 'USD' ? 'USD' : 'ARS';

  let result: { data: ParserOutput; model: string } | undefined;
  try {
    // Parseo DETERMINÍSTICO de CSV (sin LLM) si el parser lo soporta y el texto matchea
    // su formato. Si lanza CsvFormatError, el formato no aplica → caemos al LLM.
    if (isCsv && parser.parseCsv) {
      try {
        result = {
          data: parser.parseCsv(new TextDecoder().decode(bytes), { currency }),
          model: 'deterministic-csv',
        };
      } catch (e) {
        if (!(e instanceof CsvFormatError)) throw e;
      }
    }
    // Parseo DETERMINÍSTICO de XLSX (binario, sin fallback LLM): requiere parseXlsx.
    if (isXlsx) {
      if (!parser.parseXlsx) {
        throw new CsvFormatError('no hay parser determinístico de XLSX para esta institución');
      }
      const rows = await readXlsxRows(bytes);
      result = { data: parser.parseXlsx(rows, { currency }), model: 'deterministic-xlsx' };
    }
    if (!result) {
      const llm = isCsv
        ? await runParser({
            modelId,
            systemPrompt: enrichedSystemPrompt,
            userPrompt: parser.userPrompt,
            file: { kind: 'text', text: new TextDecoder().decode(bytes) },
            outputSchema: parser.schema,
          })
        : await runParser({
            modelId,
            systemPrompt: enrichedSystemPrompt,
            userPrompt: parser.userPrompt,
            file: { kind: 'pdf', base64: Buffer.from(bytes).toString('base64') },
            outputSchema: parser.schema,
          });
      result = { data: llm.data as ParserOutput, model: llm.model };
    }
  } catch (err) {
    const msg =
      err instanceof CsvFormatError
        ? `Formato no reconocido: ${err.message.slice(0, 200)}`
        : err instanceof LlmError
          ? `LLM ${err.code}: ${err.message.slice(0, 240)}`
          : 'Parseo falló';
    console.error('[imports] parse failed', {
      importId,
      code: err instanceof LlmError ? err.code : err instanceof CsvFormatError ? 'csv_format' : 'unknown',
    });
    await db
      .update(imports)
      .set({ status: 'error', errorMessage: msg })
      .where(and(eq(imports.id, importId), eq(imports.householdId, householdId)));
    return { ok: false, error: 'llm', message: msg };
  }

  // Inalcanzable (parseCsv setea result o lanza; el LLM setea result o lanza→catch).
  // Guard para el control de tipos.
  if (!result) return { ok: false, error: 'unknown' };

  const allLines = result.data.lines as (ParsedTxLine & { suggestedCategory?: string })[];

  // Hints de cuenta contraparte de los parsers determinísticos (ej. FCI → "ICBC
  // Inversiones", pago tarjeta → "Galicia Visa") → resolver a `transferAccountId` por nombre
  // y BORRAR el hint para que no quede en parsed_data. OWNER-AWARE: Galicia tiene cuentas con
  // nombre duplicado por dueño (Visa/Master/Inversiones de Nico y de Pau); se prefiere la
  // cuenta cuyo `owner_tag` coincide con el de la cuenta del import. Si queda ambiguo o sin
  // match, la línea queda como transferencia sin contraparte (el usuario la elige en revisión).
  if (allLines.some((l) => l.transferAccountName)) {
    const accs = await db
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        cardBrand: accounts.cardBrand,
        ownerTag: accounts.ownerTag,
        currencyDefault: accounts.currencyDefault,
        institutionName: institutions.name,
      })
      .from(accounts)
      .leftJoin(institutions, eq(accounts.institutionId, institutions.id))
      .where(eq(accounts.householdId, householdId));
    // Los hints de los parsers son "Institución Producto" (ej. "ICBC Inversiones",
    // "Galicia Visa") → la misma forma que `formatAccount` sin dueño/moneda. Keyamos por
    // ahí (case-insensitive) en vez de por el `name` crudo, que ahora es solo el rótulo.
    const byName = new Map<string, { id: string; ownerTag: string | null }[]>();
    for (const a of accs) {
      const k = formatAccount(
        {
          institutionName: a.institutionName,
          type: a.type,
          cardBrand: a.cardBrand,
          name: a.name,
          ownerTag: a.ownerTag,
          currency: a.currencyDefault,
        },
        { withOwner: false, withCurrency: false },
      )
        .trim()
        .toLowerCase();
      const list = byName.get(k) ?? [];
      list.push({ id: a.id, ownerTag: a.ownerTag });
      byName.set(k, list);
    }
    const importOwner = row.accountOwnerTag;
    for (const l of allLines) {
      if (l.transferAccountName) {
        const cands = byName.get(l.transferAccountName.trim().toLowerCase()) ?? [];
        const sameOwner = importOwner ? cands.filter((c) => c.ownerTag === importOwner) : [];
        const chosen =
          sameOwner.length === 1 ? sameOwner[0] : cands.length === 1 ? cands[0] : undefined;
        if (chosen) l.transferAccountId = chosen.id;
        delete l.transferAccountName;
      }
    }
  }

  // Dedup: confirmed lines in same import
  const confirmedRows = await db
    .select({ desc: sql<string>`${importLines.parsedData}->>'description'` })
    .from(importLines)
    .where(and(eq(importLines.importId, importId), isNotNull(importLines.transactionId)));
  const confirmedDescs = new Set(confirmedRows.map((r) => r.desc?.toLowerCase()));

  const filteredLines = allLines.filter(
    (line) => !confirmedDescs.has(line.description.toLowerCase()),
  );

  // Auto-detect transfers for banco imports
  const lines = row.type === 'banco' ? detectTransfers(filteredLines) : filteredLines;

  // Auto-resolución de cuenta destino por refs bancarias aprendidas (item 8):
  // si una línea transfer trae CBU/CUIT/alias de contraparte que matchea
  // EXACTAMENTE una cuenta propia (por `accounts.transfer_refs`), se asigna sola.
  if (lines.some((l) => l.isTransfer && !l.transferAccountId && l.counterparty)) {
    const refAccounts = await db
      .select({ id: accounts.id, transferRefs: accounts.transferRefs })
      .from(accounts)
      .where(and(eq(accounts.householdId, householdId), eq(accounts.archived, false)));
    const candidates = refAccounts.filter((a) => a.id !== row.accountId);
    for (const l of lines) {
      if (l.isTransfer && !l.transferAccountId && l.counterparty) {
        const matched = matchAccountByRefs(l.counterparty, candidates);
        if (matched) l.transferAccountId = matched;
      }
    }
  }

  // Cross-import dedup
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
          eq(transactions.householdId, householdId),
          eq(transactions.accountId, accountId),
          sql`${transactions.date} >= ${minDate}`,
          sql`${transactions.date} <= ${maxDate}`,
        ),
      );
    for (const tx of existingTxs) {
      existingTxKeys.add(`${tx.date}|${tx.description?.toLowerCase()}|${tx.amount}`);
    }
  }

  const catByName = new Map(tree.map((c) => [c.name.toLowerCase(), c.id]));

  const lineRows = await Promise.all(
    lines.map(async (line) => {
      // Historial por contraparte (categoría, etiqueta, deducible, tags, doméstico)
      // si la línea trae una con identidad.
      const cpHistory: CounterpartyHistory =
        line.counterparty && counterpartyHasIdentity(line.counterparty)
          ? await lookupCounterpartyHistory(householdId, line.counterparty)
          : { categoryId: null, label: null, deducible: null, tagIds: [], domesticService: null };

      // Categoría: contraparte (señal fuerte para pagos recurrentes a terceros) →
      // descripción histórica → sugerencia del LLM. Las transferencias entre cuentas
      // propias no llevan categoría.
      let proposedCategoryId = line.isTransfer ? null : cpHistory.categoryId;
      if (!proposedCategoryId) {
        proposedCategoryId = await suggestCategoryForDescription(householdId, line.description);
      }
      if (!proposedCategoryId && line.suggestedCategory) {
        proposedCategoryId = catByName.get(line.suggestedCategory.toLowerCase()) ?? null;
      }

      // Etiqueta/tags/deducible/doméstico: precargar lo aprendido sin pisar lo
      // que la línea ya trae (en transfers solo etiqueta+tags).
      const lineData: ParsedTxLine = enrichLineWithHistory(line, cpHistory);

      const lineKey = `${line.date}|${line.description.toLowerCase()}|${line.amountOriginal}`;
      const isDuplicate = existingTxKeys.has(lineKey);

      return {
        importId,
        rawData: line,
        parsedData: isDuplicate
          ? { ...lineData, notes: `[DUPLICADA] Ya existe como transacción en esta cuenta` }
          : lineData,
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

  const summary = (
    result.data as {
      summary?: { totalExpense?: string; totalIncome?: string; currency?: string };
    }
  ).summary ?? null;

  // Nº de cuenta propia del extracto (encabezado) → para auto-sugerir la cuenta destino.
  const statementAccountRef = (
    result.data as { statementAccount?: { number?: string } }
  ).statementAccount?.number ?? null;

  await db
    .update(imports)
    .set({
      status: 'parsed',
      parserModel: result.model,
      transactionCount: confirmedDescs.size + lineRows.length,
      summary,
      statementAccountRef,
      errorMessage:
        dupCount > 0
          ? `${dupCount} líneas duplicadas rechazadas automáticamente (ya existen como transacciones). ${pendingCount} pendientes de revisión.`
          : null,
    })
    .where(and(eq(imports.id, importId), eq(imports.householdId, householdId)));

  // Persistir el período cubierto por el extracto (para ordenar/filtrar en la lista).
  await computeImportPeriod(db, importId);

  revalidatePath(`/imports/${importId}`);
  revalidatePath('/imports');
  return { ok: true, lineCount: lineRows.length };
}
