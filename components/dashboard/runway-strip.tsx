import Link from 'next/link';
import type { RunwayData } from '@/lib/runway/runway-data';
import { millions, monthLabel } from '@/lib/runway/format';
import { Label, Num } from '@/components/ui/typography';

const LEVEL_COLOR = { ok: 'var(--good)', warn: 'var(--attn)', over: 'var(--bad)' } as const;

/**
 * Franja del dashboard: hasta cuándo alcanza la plata y cómo viene el gasto del
 * mes contra el techo. El detalle vive en /runway.
 */
export function RunwayStrip({ data }: { data: RunwayData }) {
  const status = data.currentMonth.status;
  const runOut = data.real?.runOutMonth;
  const pctBar = status ? Math.min(100, status.pct) : 0;

  return (
    <section className="bg-border grid grid-cols-1 gap-px sm:grid-cols-2">
      <Link
        href="/runway"
        className="bg-background hover:bg-primary/[0.03] block p-5 transition-colors"
      >
        <Label>Runway</Label>
        <Num className="text-primary mt-2 block text-2xl font-semibold">
          {!data.snapshot
            ? 'Cargá un snapshot'
            : runOut
              ? `Hasta ${monthLabel(runOut)}`
              : '> 18 meses'}
        </Num>
        <p className="text-muted-foreground mt-1 text-xs">
          {data.snapshot
            ? `Líquido ${millions(data.snapshot.totalArs)}M al ${data.snapshot.date}${data.snapshot.stale ? ' · snapshot viejo' : ''}`
            : 'Sin saldo de partida'}
        </p>
      </Link>
      <Link
        href="/runway"
        className="bg-background hover:bg-primary/[0.03] block p-5 transition-colors"
      >
        <Label>Gasto de la casa · {monthLabel(data.currentMonth.month)}</Label>
        <Num
          className="mt-2 block text-2xl font-semibold"
          style={status ? { color: LEVEL_COLOR[status.level] } : undefined}
        >
          {millions(data.currentMonth.spent)}M{data.cap ? ` / ${millions(data.cap)}M` : ''}
        </Num>
        {status ? (
          <>
            <div className="bg-muted/60 mt-2 h-1.5 w-full">
              <div
                className="h-full"
                style={{ width: `${pctBar}%`, background: LEVEL_COLOR[status.level] }}
              />
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {status.pct.toFixed(0)}% del techo · ritmo {status.pacePct.toFixed(0)}% del esperado a
              hoy
            </p>
          </>
        ) : (
          <p className="text-muted-foreground mt-1 text-xs">Sin techo: configuralo en Metas</p>
        )}
      </Link>
    </section>
  );
}
