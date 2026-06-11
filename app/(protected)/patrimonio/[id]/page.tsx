import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import Decimal from 'decimal.js';
import { eq, and } from 'drizzle-orm';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadSnapshotDetail } from '@/lib/patrimonio/load-snapshot-detail';
import { loadSnapshots } from '@/lib/patrimonio/load-snapshots';
import { getDb } from '@/lib/db/client';
import { accounts, institutions } from '@/db/schema';
import { getFxRate } from '@/lib/fx/get-fx-rate';
import { ACCOUNT_TYPE_LABELS } from '@/lib/schemas/account';
import { Display, Label, Num, Hair, Body } from '@/components/ui/typography';
import { cn } from '@/lib/utils';
import { DeleteSnapshotButton } from './delete-button';
import { SnapshotForm } from '../snapshot-form';

export const metadata = { title: 'Snapshot · gd-finanzas' };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function formatUsd(amount: string | number): string {
  const n = typeof amount === 'number' ? amount : Number.parseFloat(amount);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function shortDate(iso: string): string {
  const parts = iso.split('-');
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const mi = Number.parseInt(parts[1]!, 10) - 1;
  return `${parts[2]} ${months[mi]} ${parts[0]}`;
}

export default async function SnapshotDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const { id } = await params;
  const sp = await searchParams;
  const editing = sp.edit === 'true';

  const detail = await loadSnapshotDetail(id, session.householdId);
  if (!detail) notFound();

  if (editing) {
    const db = getDb();
    const accountRows = await db
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        cardBrand: accounts.cardBrand,
        institutionName: institutions.name,
        currencyDefault: accounts.currencyDefault,
        ownerTag: accounts.ownerTag,
      })
      .from(accounts)
      .leftJoin(institutions, eq(accounts.institutionId, institutions.id))
      .where(
        and(
          eq(accounts.householdId, session.householdId),
          eq(accounts.archived, false),
        ),
      )
      .orderBy(institutions.name, accounts.type, accounts.name);

    const allSnapshots = await loadSnapshots(session.householdId);
    const previousId = allSnapshots.find((s) => s.date < detail.date)?.id;
    const previousDetail = previousId
      ? await loadSnapshotDetail(previousId, session.householdId)
      : null;

    let todayFxRate: string | null = null;
    try {
      const fx = await getFxRate({ date: detail.date });
      todayFxRate = fx.rate.toString();
    } catch { /* no rate */ }

    return (
      <div className="space-y-8">
        <header className="pt-2">
          <Label>Patrimonio · Editar snapshot</Label>
          <Display size="lg" className="mt-3 block">
            {shortDate(detail.date)}
          </Display>
        </header>
        <SnapshotForm
          accounts={accountRows}
          previousDetail={previousDetail}
          defaultFxRate={todayFxRate}
          defaultDate={detail.date}
          editingId={id}
          editingDetail={detail}
        />
      </div>
    );
  }

  // Read-only view
  // Group balances by account type
  const balancesByType = new Map<string, typeof detail.balances>();
  for (const b of detail.balances) {
    const list = balancesByType.get(b.accountType) ?? [];
    list.push(b);
    balancesByType.set(b.accountType, list);
  }

  const balancesTotal = detail.balances.reduce(
    (acc, b) => acc.plus(b.balanceUsd),
    new Decimal(0),
  );
  const holdingsTotal = detail.holdings.reduce(
    (acc, h) => acc.plus(h.totalValueUsd),
    new Decimal(0),
  );

  return (
    <div className="space-y-10">
      {/* ============ HERO ============ */}
      <header className="flex flex-wrap items-end justify-between gap-6 pt-2">
        <div className="min-w-0">
          <Label>Patrimonio · Snapshot</Label>
          <Display size="xl" className="mt-3 block tabular-nums text-primary">
            {formatUsd(detail.totalUsd)}
          </Display>
          <Body className="mt-2">{shortDate(detail.date)}</Body>
        </div>
        <div className="flex gap-3">
          <Link
            href={`/patrimonio/${id}?edit=true`}
            className="border border-border px-5 py-2.5 font-display text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            Editar
          </Link>
          <DeleteSnapshotButton snapshotId={id} />
          <Link
            href="/patrimonio"
            className="border border-border px-5 py-2.5 font-display text-sm text-muted-foreground transition-colors hover:bg-card"
          >
            Volver
          </Link>
        </div>
      </header>

      <Hair thick />

      {/* ============ BALANCES ============ */}
      <section>
        <div className="flex items-baseline justify-between">
          <Display size="md">Saldos de cuentas</Display>
          <Num className="text-sm text-primary">{formatUsd(balancesTotal.toNumber())}</Num>
        </div>
        <Hair className="mt-3 mb-1" />

        {detail.balances.length === 0 ? (
          <Body className="mt-3">Sin saldos registrados.</Body>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {['Cuenta', 'Owner', 'Saldo', 'FX', 'USD'].map((h, i) => (
                    <th
                      key={h}
                      className={cn(
                        'py-2 font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground',
                        i >= 2 ? 'text-right' : 'text-left',
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.balances.map((b) => {
                  const isNeg = new Decimal(b.balanceUsd).isNegative();
                  return (
                    <tr key={b.id} className="border-b border-border/40">
                      <td className="py-3">
                        <span className="font-display text-sm text-foreground">{b.accountName}</span>
                        <span className="ml-2 font-sans text-[9px] uppercase tracking-wide text-muted-foreground">
                          {ACCOUNT_TYPE_LABELS[b.accountType as keyof typeof ACCOUNT_TYPE_LABELS] ?? b.accountType}
                        </span>
                      </td>
                      <td className="py-3 font-sans text-xs text-muted-foreground">{b.ownerTag}</td>
                      <td className="py-3 text-right">
                        <Num className={cn('text-sm', isNeg ? 'text-[color:var(--bad)]' : 'text-foreground')}>
                          {Number.parseFloat(b.balance).toLocaleString('es-AR', { minimumFractionDigits: 2 })} {b.currency}
                        </Num>
                      </td>
                      <td className="py-3 text-right">
                        <Num className="text-xs text-muted-foreground">
                          {b.fxRateUsed ?? '—'}
                        </Num>
                      </td>
                      <td className="py-3 text-right">
                        <Num className={cn('text-sm font-semibold', isNeg ? 'text-[color:var(--bad)]' : 'text-foreground')}>
                          {formatUsd(b.balanceUsd)}
                        </Num>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ============ HOLDINGS ============ */}
      {detail.holdings.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between">
            <Display size="md">Holdings</Display>
            <Num className="text-sm text-primary">{formatUsd(holdingsTotal.toNumber())}</Num>
          </div>
          <Hair className="mt-3 mb-1" />

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {['Ticker', 'Nombre', 'Tipo', 'Cant.', 'Precio', 'Total USD'].map((h, i) => (
                    <th
                      key={h}
                      className={cn(
                        'py-2 font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground',
                        i >= 3 ? 'text-right' : 'text-left',
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.holdings.map((h) => (
                  <tr key={h.id} className="border-b border-border/40">
                    <td className="py-3">
                      <Num className="text-sm font-semibold text-foreground">{h.ticker}</Num>
                    </td>
                    <td className="py-3 font-display text-sm text-foreground">{h.name}</td>
                    <td className="py-3">
                      <span className="inline-block rounded-sm bg-primary/10 px-2 py-0.5 font-sans text-[9px] font-semibold uppercase tracking-wide text-primary">
                        {h.assetType}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <Num className="text-sm text-foreground">{Number.parseFloat(h.quantity).toLocaleString('es-AR')}</Num>
                    </td>
                    <td className="py-3 text-right">
                      <Num className="text-sm text-muted-foreground">
                        {Number.parseFloat(h.pricePerUnit).toLocaleString('es-AR', { minimumFractionDigits: 2 })} {h.currency}
                      </Num>
                    </td>
                    <td className="py-3 text-right">
                      <Num className="text-sm font-semibold text-foreground">
                        {formatUsd(h.totalValueUsd)}
                      </Num>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ============ NOTES ============ */}
      {detail.notes && (
        <section>
          <Display size="sm">Notas</Display>
          <Hair className="mt-2 mb-3" />
          <Body>{detail.notes}</Body>
        </section>
      )}
    </div>
  );
}
