'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { accounts, imports, importLines } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { parsedTxLineSchema } from '@/lib/imports/parsers/types';
import {
  counterpartyHasIdentity,
  enrichLineWithHistory,
  lookupCounterpartyHistory,
} from '@/lib/imports/counterparty-suggest';
import { matchAccountByRefs } from '@/lib/imports/counterparty-identity';
import { suggestCategoryForDescription } from '@/lib/imports/category-suggest';

const inputSchema = z.object({ importId: z.string().uuid() });

export type ResuggestPendingResult =
  | { ok: true; updated: number; scanned: number }
  | { ok: false; error: 'session' | 'invalid_input' | 'not_found' | 'unknown' };

/**
 * Pase NO-DESTRUCTIVO de re-sugerencia sobre las líneas `pending` de un import
 * ya parseado: aplica el aprendizaje por contraparte (categoría, etiqueta,
 * deducible, tags, doméstico) y la auto-resolución de cuenta destino por
 * CBU/CUIT con el estado de HOY del historial. Solo completa vacíos — nunca
 * pisa ediciones/aceptaciones (esas líneas ni se tocan: el filtro es status
 * pending) ni valores ya presentes (enrichLineWithHistory es aditivo).
 *
 * Es la pieza que hace que las features de sugerencia apliquen a los imports
 * EN CURSO, no solo a los que se parseen de acá en adelante (nota transversal
 * del backlog, confirmada con Nico).
 */
export async function resuggestPendingLines(input: {
  importId: string;
}): Promise<ResuggestPendingResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const db = getDb();

  const [imp] = await db
    .select({ id: imports.id, accountId: imports.accountId })
    .from(imports)
    .where(
      and(eq(imports.id, parsed.data.importId), eq(imports.householdId, session.householdId)),
    )
    .limit(1);
  if (!imp) return { ok: false, error: 'not_found' };

  const pendingLines = await db
    .select({
      id: importLines.id,
      parsedData: importLines.parsedData,
      proposedCategoryId: importLines.proposedCategoryId,
    })
    .from(importLines)
    .where(
      and(
        eq(importLines.importId, parsed.data.importId),
        eq(importLines.status, 'pending'),
        isNull(importLines.transactionId),
      ),
    );

  if (pendingLines.length === 0) return { ok: true, updated: 0, scanned: 0 };

  const refAccounts = await db
    .select({ id: accounts.id, transferRefs: accounts.transferRefs })
    .from(accounts)
    .where(and(eq(accounts.householdId, session.householdId), eq(accounts.archived, false)));
  const refCandidates = refAccounts.filter((a) => a.id !== imp.accountId);

  let updated = 0;
  try {
    for (const row of pendingLines) {
      const pd = parsedTxLineSchema.safeParse(row.parsedData);
      if (!pd.success) continue;
      const line = pd.data;

      const cpHistory =
        line.counterparty && counterpartyHasIdentity(line.counterparty)
          ? await lookupCounterpartyHistory(session.householdId, line.counterparty)
          : { categoryId: null, label: null, deducible: null, tagIds: [], domesticService: null };

      let next = enrichLineWithHistory(line, cpHistory);

      // Cuenta destino por refs aprendidas (solo transfers sin destino).
      if (next.isTransfer && !next.transferAccountId && next.counterparty) {
        const matched = matchAccountByRefs(next.counterparty, refCandidates);
        if (matched) next = { ...next, transferAccountId: matched };
      }

      // Categoría: solo si sigue vacía y no es transfer.
      let nextCategoryId = row.proposedCategoryId;
      if (!nextCategoryId && !next.isTransfer) {
        nextCategoryId =
          cpHistory.categoryId ??
          (await suggestCategoryForDescription(session.householdId, next.description));
      }

      const parsedChanged = JSON.stringify(next) !== JSON.stringify(line);
      const categoryChanged = nextCategoryId !== row.proposedCategoryId;
      if (!parsedChanged && !categoryChanged) continue;

      await db
        .update(importLines)
        .set({
          ...(parsedChanged ? { parsedData: next } : {}),
          ...(categoryChanged ? { proposedCategoryId: nextCategoryId } : {}),
          // status queda 'pending': es una sugerencia, la revisión sigue pendiente.
        })
        .where(
          and(eq(importLines.id, row.id), eq(importLines.importId, parsed.data.importId)),
        );
      updated += 1;
    }
  } catch (err) {
    console.error('[imports] resuggest-pending failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }

  revalidatePath(`/imports/${parsed.data.importId}`);
  return { ok: true, updated, scanned: pendingLines.length };
}
