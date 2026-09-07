import Link from 'next/link';
import { redirect } from 'next/navigation';
import Decimal from 'decimal.js';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadSnapshots } from '@/lib/patrimonio/load-snapshots';
import { getLatestNetWorth } from '@/lib/patrimonio/net-worth-series';
import { getDb } from '@/lib/db/client';
import { financialGoals } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { FINANCIAL_GOALS_DEFAULTS } from '@/lib/financial-goals/defaults';
import { Display, Label, Num, Hair, Body } from '@/components/ui/typography';
import { cn } from '@/lib/utils';
import { NetWorthChart } from './net-worth-chart';

export const metadata = { title: 'Patrimonio · gd-finanzas' };

function formatUsd(amount: string | number, withDecimals = false): string {
  const n = typeof amount === 'number' ? amount : Number.parseFloat(amount);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: withDecimals ? 2 : 0,
    maximumFractionDigits: withDecimals ? 2 : 0,
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

export default async function PatrimonioPage() {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const [snapshots, latest] = await Promise.all([
    loadSnapshots(session.householdId),
    getLatestNetWorth(session.householdId),
  ]);

  // Load target
  const db = getDb();
  const [goals] = await db
    .select({
      numeroRetiroUsd: financialGoals.numeroRetiroUsd,
      numeroEducacionUsd: financialGoals.numeroEducacionUsd,
      bufferUsd: financialGoals.bufferUsd,
    })
    .from(financialGoals)
    .where(eq(financialGoals.householdId, session.householdId))
    .limit(1);

  const targetTotal = goals
    ? new Decimal(goals.numeroRetiroUsd).plus(goals.numeroEducacionUsd).plus(goals.bufferUsd)
    : new Decimal(FINANCIAL_GOALS_DEFAULTS.numeroRetiroUsd)
        .plus(FINANCIAL_GOALS_DEFAULTS.numeroEducacionUsd)
        .plus(FINANCIAL_GOALS_DEFAULTS.bufferUsd);

  const currentNw = latest ? new Decimal(latest.totalUsd) : null;
  const progressPct = currentNw ? currentNw.div(targetTotal).times(100).toNumber() : null;
  const distanceUsd = currentNw ? targetTotal.minus(currentNw) : null;

  // Variation vs previous snapshot
  const prevSnapshot = snapshots.length >= 2 ? snapshots[1] : null;
  const variation =
    latest && prevSnapshot ? new Decimal(latest.totalUsd).minus(prevSnapshot.totalUsd) : null;

  // Chart data
  const chartData = snapshots
    .slice()
    .reverse()
    .map((s) => ({ date: s.date, totalUsd: Number.parseFloat(s.totalUsd) }));

  return (
    <div className="space-y-10">
      {/* ============ HERO ============ */}
      <header className="flex flex-wrap items-end justify-between gap-6 pt-2">
        <div className="min-w-0">
          <Label>Patrimonio neto</Label>
          <Display size="xl" className="text-primary mt-3 block tabular-nums">
            {currentNw ? formatUsd(currentNw.toNumber()) : '—'}
          </Display>
          {latest && (
            <Body className="mt-2">
              Al {shortDate(latest.date)}
              {variation && !variation.isZero() && (
                <>
                  {' · '}
                  <Num
                    className={cn(
                      'text-sm font-semibold',
                      variation.isPositive()
                        ? 'text-[color:var(--good)]'
                        : 'text-[color:var(--bad)]',
                    )}
                  >
                    {variation.isPositive() ? '+' : ''}
                    {formatUsd(variation.toNumber())}
                  </Num>
                  {' vs snapshot anterior'}
                </>
              )}
            </Body>
          )}
        </div>

        <Link
          href="/patrimonio/nuevo"
          className="bg-primary font-display text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-colors"
        >
          + Nuevo snapshot
        </Link>
      </header>

      <Hair thick />

      {/* ============ KPI STRIP ============ */}
      <section className="bg-border grid grid-cols-1 gap-px sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Patrimonio actual"
          value={currentNw ? formatUsd(currentNw.toNumber()) : '—'}
          variant="primary"
        />
        <KpiCard label="Target total" value={formatUsd(targetTotal.toNumber())} variant="attn" />
        <KpiCard
          label="Progreso"
          value={progressPct !== null ? `${progressPct.toFixed(1)}%` : '—'}
          variant="primary"
        />
        <KpiCard
          label="Distancia al target"
          value={distanceUsd ? formatUsd(distanceUsd.toNumber()) : '—'}
          variant={distanceUsd && distanceUsd.isNegative() ? 'good' : 'bad'}
        />
      </section>

      {/* ============ PROGRESS BAR ============ */}
      {progressPct !== null && (
        <section className="relative">
          <div className="bg-muted/60 h-2 w-full">
            <div
              className="bg-primary h-full transition-all"
              style={{ width: `${Math.min(100, progressPct)}%` }}
            />
          </div>
          <div className="text-muted-foreground mt-2 flex items-center justify-between font-sans text-[10px] tracking-[0.18em] uppercase">
            <span>USD 0</span>
            <span>{formatUsd(targetTotal.toNumber())}</span>
          </div>
        </section>
      )}

      {/* ============ CHART ============ */}
      {chartData.length >= 2 && (
        <section>
          <div className="flex items-baseline justify-between">
            <Display size="md">Evolución del patrimonio</Display>
            <Label>{chartData.length} snapshots</Label>
          </div>
          <Hair className="mt-3 mb-4" />
          <NetWorthChart data={chartData} targetUsd={targetTotal.toNumber()} />
        </section>
      )}

      {/* ============ SNAPSHOTS TABLE ============ */}
      <section>
        <div className="flex items-baseline justify-between">
          <Display size="md">Historial de snapshots</Display>
          <Label>{snapshots.length} registros</Label>
        </div>
        <Hair className="mt-3 mb-1" />

        {snapshots.length === 0 ? (
          <Body className="mt-4">
            Sin snapshots todavía.{' '}
            <Link href="/patrimonio/nuevo" className="link text-primary">
              Cargá el primero →
            </Link>
          </Body>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-border border-b">
                  {['Fecha', 'Net worth', 'Variación', ''].map((h, i) => (
                    <th
                      key={h || `empty-${i}`}
                      className={cn(
                        'text-muted-foreground py-2 font-sans text-[10px] font-semibold tracking-[0.18em] uppercase',
                        i >= 1 && i <= 2 ? 'text-right' : 'text-left',
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s, i) => {
                  const prev = snapshots[i + 1];
                  const delta = prev ? new Decimal(s.totalUsd).minus(prev.totalUsd) : null;
                  return (
                    <tr
                      key={s.id}
                      className="border-border/40 hover:bg-primary/[0.04] border-b transition-colors"
                    >
                      <td className="py-3">
                        <Num className="text-muted-foreground text-[11px] tracking-[0.1em] uppercase">
                          {shortDate(s.date)}
                        </Num>
                      </td>
                      <td className="py-3 text-right">
                        <Num className="text-foreground text-sm">{formatUsd(s.totalUsd)}</Num>
                      </td>
                      <td className="py-3 text-right">
                        {delta && !delta.isZero() ? (
                          <Num
                            className={cn(
                              'text-sm font-semibold',
                              delta.isPositive()
                                ? 'text-[color:var(--good)]'
                                : 'text-[color:var(--bad)]',
                            )}
                          >
                            {delta.isPositive() ? '+' : ''}
                            {formatUsd(delta.toNumber())}
                          </Num>
                        ) : (
                          <Num className="text-muted-foreground text-sm">—</Num>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <Link
                          href={`/patrimonio/${s.id}`}
                          className="link font-display text-muted-foreground text-sm italic"
                        >
                          Ver detalle →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  variant = 'primary',
}: {
  label: string;
  value: string;
  variant?: 'primary' | 'good' | 'bad' | 'attn';
}) {
  const colorVar =
    variant === 'good'
      ? 'var(--good)'
      : variant === 'bad'
        ? 'var(--bad)'
        : variant === 'attn'
          ? 'var(--attn)'
          : 'var(--primary)';
  return (
    <div className="bg-card p-5">
      <Label>{label}</Label>
      <Display size="md" className="mt-3 block tabular-nums" style={{ color: colorVar }}>
        {value}
      </Display>
    </div>
  );
}
