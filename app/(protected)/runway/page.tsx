import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadRunwayData, BASE_WINDOW_MONTHS, SNAPSHOT_STALE_DAYS } from '@/lib/runway/runway-data';
import { ars, millions, monthLabel } from '@/lib/runway/format';
import { Display, Label, Num, Hair, Body } from '@/components/ui/typography';
import { cn } from '@/lib/utils';
import { RunwayChart } from './runway-chart';

export const metadata = { title: 'Runway · gd-finanzas' };

const LEVEL_COLOR = { ok: 'var(--good)', warn: 'var(--attn)', over: 'var(--bad)' } as const;

export default async function RunwayPage() {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const data = await loadRunwayData(session.householdId);
  const { snapshot, real, withCap, baseBurn, cap, currentMonth } = data;

  return (
    <div className="space-y-10">
      <header className="pt-2">
        <Label>Runway</Label>
        <Display size="xl" className="mt-3 block">
          {real
            ? real.runOutMonth
              ? `Hasta ${monthLabel(real.runOutMonth)}`
              : 'Más de 18 meses'
            : '—'}
        </Display>
        <Body className="mt-2 max-w-2xl">
          Cuánto dura la plata al ritmo de gasto actual, contando ingresos recurrentes, cuotas de
          tarjeta pendientes y gastos puntuales (alquiler anual, vacaciones). Montos en millones de
          ARS, nominales, dólar oficial de hoy ({ars(data.fxRate)}).
        </Body>
      </header>

      {!snapshot ? (
        <div className="border-border border border-dashed p-10 text-center">
          <Body>
            Para calcular el runway hace falta saber cuánto hay hoy.{' '}
            <Link href="/patrimonio/nuevo" className="link text-primary">
              Cargá un snapshot de patrimonio →
            </Link>
          </Body>
        </div>
      ) : (
        <>
          <section className="bg-border grid grid-cols-1 gap-px sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label={`Líquido al ${snapshot.date}`}
              value={`${millions(snapshot.totalArs)}M`}
              hint={
                snapshot.stale
                  ? `Snapshot de más de ${SNAPSHOT_STALE_DAYS} días: actualizalo`
                  : undefined
              }
              tone={snapshot.stale ? 'bad' : undefined}
            />
            <Kpi
              label="Se termina · ritmo actual"
              value={real?.runOutMonth ? monthLabel(real.runOutMonth) : '> 18 meses'}
              tone="primary"
            />
            <Kpi
              label="Se termina · con tope"
              value={
                withCap
                  ? withCap.runOutMonth
                    ? monthLabel(withCap.runOutMonth)
                    : '> 18 meses'
                  : 'Sin tope'
              }
              tone="attn"
            />
            <Kpi
              label={`Gasto ${monthLabel(currentMonth.month)}`}
              value={`${millions(currentMonth.spent)}M${cap ? ` / ${millions(cap)}M` : ''}`}
              hint={
                currentMonth.status
                  ? `${currentMonth.status.pct.toFixed(0)}% del tope · ritmo ${currentMonth.status.pacePct.toFixed(0)}%`
                  : 'Sin tope configurado'
              }
              color={currentMonth.status ? LEVEL_COLOR[currentMonth.status.level] : undefined}
            />
          </section>

          {real && (
            <section>
              <div className="flex items-baseline justify-between">
                <Display size="md">Saldo proyectado</Display>
                <Label>18 meses</Label>
              </div>
              <Hair className="mt-3 mb-4" />
              <RunwayChart
                data={real.rows.map((r, i) => ({
                  month: r.month,
                  label: monthLabel(r.month),
                  real: r.balance.toNumber(),
                  tope: withCap?.rows[i]?.balance.toNumber() ?? null,
                }))}
                floor={data.bufferArs?.toNumber() ?? null}
              />
            </section>
          )}

          {real && (
            <section>
              <Display size="md">Mes a mes · ritmo actual</Display>
              <Hair className="mt-3 mb-1" />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-muted-foreground text-right font-sans text-[10px] tracking-[0.18em] uppercase">
                      <th className="py-2 text-left">Mes</th>
                      <th>Ingresos</th>
                      <th>Gasto base</th>
                      <th>Cuotas</th>
                      <th>Puntuales</th>
                      <th>Gap</th>
                      <th>Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {real.rows.map((r) => (
                      <tr
                        key={r.month}
                        className="border-border/40 border-t text-right tabular-nums"
                      >
                        <td className="py-2 text-left">{monthLabel(r.month)}</td>
                        <td>
                          <Num>{millions(r.income)}</Num>
                        </td>
                        <td>
                          <Num>{millions(r.base)}</Num>
                        </td>
                        <td>
                          <Num>{millions(r.cuotas)}</Num>
                        </td>
                        <td title={r.eventLabels.join(', ')}>
                          <Num>{r.events.isZero() ? '—' : millions(r.events)}</Num>
                          {r.eventLabels.length > 0 && (
                            <span className="text-muted-foreground ml-1 text-xs">
                              {r.eventLabels.join(', ')}
                            </span>
                          )}
                        </td>
                        <td>
                          <Num
                            className={cn(
                              r.gap.isNegative()
                                ? 'text-[color:var(--bad)]'
                                : 'text-[color:var(--good)]',
                            )}
                          >
                            {millions(r.gap)}
                          </Num>
                        </td>
                        <td>
                          <Num
                            className={cn(
                              'font-semibold',
                              r.balance.isNegative() && 'text-[color:var(--bad)]',
                            )}
                          >
                            {millions(r.balance)}
                          </Num>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      <section>
        <Display size="md">Supuestos</Display>
        <Hair className="mt-3 mb-3" />
        <ul className="text-muted-foreground list-disc space-y-1.5 pl-5 text-sm">
          <li>
            <span className="text-foreground">Gasto base {millions(baseBurn.average)}M/mes</span>:
            promedio de{' '}
            {baseBurn.months.length > 0
              ? baseBurn.months.map(monthLabel).join(', ')
              : 'sin meses con datos'}{' '}
            (últimos {BASE_WINDOW_MONTHS} cerrados), sin cuotas de tarjeta, sin categorías{' '}
            <Link href="/settings/categorias" className="link">
              fuera de la casa
            </Link>{' '}
            y sin las categorías de gastos anuales.
          </li>
          <li>
            Ingresos y gastos puntuales salen de las{' '}
            <Link href="/recurrences" className="link">
              recurrencias activas
            </Link>
            {data.eventNames.length > 0 && ` (puntuales: ${data.eventNames.join(', ')})`}.
          </li>
          {data.releaseNames.length > 0 && (
            <li>
              Gastos mensuales que terminan y bajan el gasto base: {data.releaseNames.join(', ')}.
            </li>
          )}
          <li>
            Cuotas: lo que queda de las cuotas del último resumen de cada tarjeta, en el mes en que
            se pagan.
          </li>
          <li>
            Techo mensual: {cap ? `${millions(cap)}M` : 'no configurado'} (
            <Link href="/settings/metas" className="link">
              editar
            </Link>
            ).
          </li>
          <li>Sin inflación: todo nominal en pesos, dólares al oficial de hoy.</li>
        </ul>
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
  color,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'primary' | 'attn' | 'bad';
  color?: string;
}) {
  const toneColor =
    color ??
    (tone === 'primary'
      ? 'var(--primary)'
      : tone === 'attn'
        ? 'var(--attn)'
        : tone === 'bad'
          ? 'var(--bad)'
          : undefined);
  return (
    <div className="bg-background p-5">
      <Label>{label}</Label>
      <Num
        className="mt-2 block text-2xl font-semibold"
        style={toneColor ? { color: toneColor } : undefined}
      >
        {value}
      </Num>
      {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
    </div>
  );
}
