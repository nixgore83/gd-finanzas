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
  const months = [
    'ene',
    'feb',
    'mar',
    'abr',
    'may',
    'jun',
    'jul',
    'ago',
    'sep',
    'oct',
    'nov',
    'dic',
  ];
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
      .where(and(eq(accounts.householdId, session.householdId), eq(accounts.archived, false)))
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
    } catch {
      /* no rate */
    }

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

  const balancesTotal = detail.balances.reduce((acc, b) => acc.plus(b.balanceUsd), new Decimal(0));
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
          <Display size="xl" className="text-primary mt-3 block tabular-nums">
            {formatUsd(detail.totalUsd)}
          </Display>
          <Body className="mt-2">{shortDate(detail.date)}</Body>
        </div>
        <div className="flex gap-3">
          <Link
            href={`/patrimonio/${id}?edit=true`}
            className="border-border font-display text-muted-foreground hover:bg-card hover:text-foreground border px-5 py-2.5 text-sm transition-colors"
          >
            Editar
          </Link>
          <DeleteSnapshotButton snapshotId={id} />
          <Link
            href="/patrimonio"
            className="border-border font-display text-muted-foreground hover:bg-card border px-5 py-2.5 text-sm transition-colors"
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
          <Num className="text-primary text-sm">{formatUsd(balancesTotal.toNumber())}</Num>
        </div>
        <Hair className="mt-3 mb-1" />

        {detail.balances.length === 0 ? (
          <Body className="mt-3">Sin saldos registrados.</Body>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-border border-b">
                  {['Cuenta', 'Owner', 'Saldo', 'FX', 'USD'].map((h, i) => (
                    <th
                      key={h}
                      className={cn(
                        'text-muted-foreground py-2 font-sans text-[10px] font-semibold tracking-[0.18em] uppercase',
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
                    <tr key={b.id} className="border-border/40 border-b">
                      <td className="py-3">
                        <span className="font-display text-foreground text-sm">
                          {b.accountName}
                        </span>
                        <span className="text-muted-foreground ml-2 font-sans text-[9px] tracking-wide uppercase">
                          {ACCOUNT_TYPE_LABELS[b.accountType as keyof typeof ACCOUNT_TYPE_LABELS] ??
                            b.accountType}
                        </span>
                      </td>
                      <td className="text-muted-foreground py-3 font-sans text-xs">{b.ownerTag}</td>
                      <td className="py-3 text-right">
                        <Num
                          className={cn(
                            'text-sm',
                            isNeg ? 'text-[color:var(--bad)]' : 'text-foreground',
                          )}
                        >
                          {Number.parseFloat(b.balance).toLocaleString('es-AR', {
                            minimumFractionDigits: 2,
                          })}{' '}
                          {b.currency}
                        </Num>
                      </td>
                      <td className="py-3 text-right">
                        <Num className="text-muted-foreground text-xs">{b.fxRateUsed ?? '—'}</Num>
                      </td>
                      <td className="py-3 text-right">
                        <Num
                          className={cn(
                            'text-sm font-semibold',
                            isNeg ? 'text-[color:var(--bad)]' : 'text-foreground',
                          )}
                        >
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
            <Num className="text-primary text-sm">{formatUsd(holdingsTotal.toNumber())}</Num>
          </div>
          <Hair className="mt-3 mb-1" />

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-border border-b">
                  {['Ticker', 'Nombre', 'Tipo', 'Cant.', 'Precio', 'Total USD'].map((h, i) => (
                    <th
                      key={h}
                      className={cn(
                        'text-muted-foreground py-2 font-sans text-[10px] font-semibold tracking-[0.18em] uppercase',
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
                  <tr key={h.id} className="border-border/40 border-b">
                    <td className="py-3">
                      <Num className="text-foreground text-sm font-semibold">{h.ticker}</Num>
                    </td>
                    <td className="font-display text-foreground py-3 text-sm">{h.name}</td>
                    <td className="py-3">
                      <span className="bg-primary/10 text-primary inline-block rounded-sm px-2 py-0.5 font-sans text-[9px] font-semibold tracking-wide uppercase">
                        {h.assetType}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <Num className="text-foreground text-sm">
                        {Number.parseFloat(h.quantity).toLocaleString('es-AR')}
                      </Num>
                    </td>
                    <td className="py-3 text-right">
                      <Num className="text-muted-foreground text-sm">
                        {Number.parseFloat(h.pricePerUnit).toLocaleString('es-AR', {
                          minimumFractionDigits: 2,
                        })}{' '}
                        {h.currency}
                      </Num>
                    </td>
                    <td className="py-3 text-right">
                      <Num className="text-foreground text-sm font-semibold">
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
