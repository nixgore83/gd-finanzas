'use server';

import { and, eq, gte, isNull, lte, ne } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { accounts, institutions, transactions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { formatAccount } from '@/lib/accounts/format';
import { selectSameCurrencyTransferMatch } from '@/app/actions/transactions/_build-transfer';
import { MATCH_DATE_WINDOW_DAYS } from '@/lib/forecasts/candidates';

const inputSchema = z.object({
  /** Cuenta del extracto (se excluye de la búsqueda). */
  importAccountId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['income', 'expense']),
  amount: z.string().regex(/^-?\d+(\.\d+)?$/),
  currency: z.enum(['ARS', 'USD']),
});

export type LineTransferMatch = {
  transactionId: string;
  accountId: string;
  accountLabel: string;
  date: string;
  amountOriginal: string;
};

export type LineTransferMatchResult =
  | { ok: true; match: LineTransferMatch | null }
  | { ok: false; error: 'session' | 'invalid_input' | 'unknown' };

/**
 * Item 14: ¿esta línea transfer matchea una transacción YA existente (la pata del
 * otro extracto, importada antes)? Misma regla que el match-al-confirmar (#44):
 * pata-transfer sin parear, otra cuenta, misma moneda, dirección opuesta,
 * monto ±10%, fecha ±5 días, y EXACTAMENTE un candidato. Permite mostrar el
 * match en la review y pre-cargar la cuenta destino; el pareo real lo hace el
 * confirm.
 */
export async function findLineTransferMatch(input: {
  importAccountId: string;
  date: string;
  kind: 'income' | 'expense';
  amount: string;
  currency: 'ARS' | 'USD';
}): Promise<LineTransferMatchResult> {
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

  try {
    const dateMs = Date.parse(`${parsed.data.date}T00:00:00Z`);
    const lower = new Date(dateMs - MATCH_DATE_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    const upper = new Date(dateMs + MATCH_DATE_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

    const candidates = await db
      .select({
        id: transactions.id,
        amountOriginal: transactions.amountOriginal,
        date: transactions.date,
        accountId: transactions.accountId,
        accountName: accounts.name,
        accountType: accounts.type,
        cardBrand: accounts.cardBrand,
        ownerTag: accounts.ownerTag,
        currencyDefault: accounts.currencyDefault,
        institutionName: institutions.name,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .leftJoin(institutions, eq(institutions.id, accounts.institutionId))
      .where(
        and(
          eq(transactions.householdId, session.householdId),
          eq(transactions.kind, 'transfer'),
          isNull(transactions.transferPairId),
          ne(transactions.accountId, parsed.data.importAccountId),
          eq(accounts.currencyDefault, parsed.data.currency),
          gte(transactions.date, lower),
          lte(transactions.date, upper),
        ),
      );

    const isOutgoing = parsed.data.kind === 'expense';
    const matchedId = selectSameCurrencyTransferMatch(candidates, parsed.data.amount, isOutgoing);
    if (!matchedId) return { ok: true, match: null };

    const m = candidates.find((c) => c.id === matchedId)!;
    return {
      ok: true,
      match: {
        transactionId: m.id,
        accountId: m.accountId,
        accountLabel: formatAccount({
          institutionName: m.institutionName,
          type: m.accountType,
          cardBrand: m.cardBrand,
          name: m.accountName,
          ownerTag: m.ownerTag,
          currency: m.currencyDefault,
        }),
        date: m.date,
        amountOriginal: m.amountOriginal,
      },
    };
  } catch (err) {
    console.error('[imports] line-transfer-match failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
