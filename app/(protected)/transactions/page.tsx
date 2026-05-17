import Link from 'next/link';
import { redirect } from 'next/navigation';
import { asc, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, categories, transactions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { TRANSACTION_KIND_LABELS, type TransactionKind } from '@/lib/schemas/transaction';
import { Button } from '@/components/ui/button';
import { DeleteTransactionButton } from './delete-button';

export const metadata = {
  title: 'Transacciones · gd-finanzas',
};

const PAGE_LIMIT = 50;

function formatAmount(amount: string, currency: 'ARS' | 'USD'): string {
  const n = Number.parseFloat(amount);
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

export default async function TransactionsPage() {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const db = getDb();

  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      kind: transactions.kind,
      amountOriginal: transactions.amountOriginal,
      currencyOriginal: transactions.currencyOriginal,
      amountUsd: transactions.amountUsd,
      description: transactions.description,
      accountName: accounts.name,
      categoryName: categories.name,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(eq(transactions.householdId, session.householdId))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(PAGE_LIMIT);

  // Cuentas para empty state guard
  const accountCount = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.householdId, session.householdId))
    .orderBy(asc(accounts.name))
    .limit(1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Transacciones</h1>
        <Button asChild>
          <Link href="/transactions/new">+ Nueva transacción</Link>
        </Button>
      </div>

      {accountCount.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Necesitás al menos una cuenta. Andá a{' '}
          <Link href="/accounts/new" className="underline">
            /accounts/new
          </Link>
          .
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Sin transacciones todavía. Cargá la primera.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Fecha</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Cuenta</th>
                <th className="px-3 py-2 font-medium">Categoría</th>
                <th className="px-3 py-2 text-right font-medium">Monto</th>
                <th className="px-3 py-2 text-right font-medium">USD</th>
                <th className="px-3 py-2 font-medium">Descripción</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{row.date}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        row.kind === 'income'
                          ? 'rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700'
                          : 'rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700'
                      }
                    >
                      {TRANSACTION_KIND_LABELS[row.kind as TransactionKind] ?? row.kind}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.accountName ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.categoryName ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatAmount(row.amountOriginal, row.currencyOriginal)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatAmount(row.amountUsd, 'USD')}
                  </td>
                  <td className="px-3 py-2">{row.description}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/transactions/${row.id}`}>Editar</Link>
                      </Button>
                      <DeleteTransactionButton id={row.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
