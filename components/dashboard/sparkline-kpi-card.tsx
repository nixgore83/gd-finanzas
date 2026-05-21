'use client';

import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';
import { Display, Label, Num } from '@/components/ui/typography';

type Props = {
  label: string;
  value: string;
  /** Opcional: segunda línea con el equivalente en otra moneda (ARS ↔ USD). */
  altValue?: string | null;
  delta?: { text: string; tone: 'good' | 'bad' | 'neutral' } | null;
  data: number[];
  /**
   * Variante semántica del KPI — define el color del sparkline.
   * `primary` (sage) por default.
   */
  variant?: 'primary' | 'good' | 'bad' | 'attn';
  /**
   * Compat con el API anterior (`color="emerald" | "rose" | "violet" | "sky"`).
   * Se mapea internamente a `variant`. Se prefiere `variant` para código nuevo.
   * @deprecated usar `variant` directamente.
   */
  color?: 'emerald' | 'rose' | 'violet' | 'sky';
};

const COLOR_TO_VARIANT: Record<NonNullable<Props['color']>, NonNullable<Props['variant']>> = {
  emerald: 'good',
  rose: 'bad',
  violet: 'attn',
  sky: 'primary',
};

/**
 * KPI card de Vault Sage.
 *
 * - Label uppercase tracked arriba
 * - Número grande en serif (Cormorant via <Display>)
 * - Equivalente en otra moneda debajo, en mono pequeño muted
 * - Sparkline area sin grid, con gradient fade y dot final
 * - Delta como pill discreto a la derecha
 */
export function SparklineKpiCard({
  label,
  value,
  altValue,
  delta,
  data,
  variant,
  color,
}: Props) {
  const series = data.map((v, i) => ({ i, v }));
  const v: NonNullable<Props['variant']> = variant ?? (color ? COLOR_TO_VARIANT[color] : 'primary');

  // Colores leídos vía CSS vars → se ajustan light/dark sin tocar nada.
  const strokeVar =
    v === 'good'
      ? 'var(--good)'
      : v === 'bad'
        ? 'var(--bad)'
        : v === 'attn'
          ? 'var(--attn)'
          : 'var(--primary)';

  const gradId = `kpi-grad-${label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div className="group flex h-full flex-col border border-border bg-card p-5 transition-colors hover:border-primary/40">
      <Label>{label}</Label>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Display size="md" className="block tabular-nums text-foreground">
            {value}
          </Display>
          {altValue && (
            <Num className="mt-1 block text-[11px] text-muted-foreground">
              ≈ {altValue}
            </Num>
          )}
        </div>
        <div className="-mb-1 h-10 w-24 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={strokeVar} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={strokeVar} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                dataKey="v"
                type="monotone"
                stroke={strokeVar}
                strokeWidth={1.5}
                fill={`url(#${gradId})`}
                isAnimationActive={false}
                dot={false}
                activeDot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {delta && (
        <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
          <span
            className={cn(
              'font-sans text-[10px] font-semibold uppercase tracking-[0.14em]',
              delta.tone === 'good' && 'text-[color:var(--good)]',
              delta.tone === 'bad' && 'text-[color:var(--bad)]',
              delta.tone === 'neutral' && 'text-muted-foreground',
            )}
          >
            <Num>{delta.text}</Num>
          </span>
          <span className="font-sans text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            vs mes ant.
          </span>
        </div>
      )}
    </div>
  );
}
