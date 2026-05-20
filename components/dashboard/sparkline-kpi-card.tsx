'use client';

import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';

type Props = {
  label: string;
  value: string;
  delta?: { text: string; tone: 'good' | 'bad' | 'neutral' } | null;
  data: number[];
  /** Color de la línea + área. Por default emerald. */
  color?: 'emerald' | 'rose' | 'violet' | 'sky';
};

const COLOR_HEX: Record<NonNullable<Props['color']>, string> = {
  emerald: '#10b981',
  rose: '#f43f5e',
  violet: '#8b5cf6',
  sky: '#0ea5e9',
};

export function SparklineKpiCard({ label, value, delta, data, color = 'emerald' }: Props) {
  const hex = COLOR_HEX[color];
  const series = data.map((v, i) => ({ i, v }));

  return (
    <div className="flex h-full flex-col rounded-md border border-border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {delta && (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
              delta.tone === 'good'
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                : delta.tone === 'bad'
                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
                  : 'bg-muted text-muted-foreground',
            )}
          >
            {delta.text}
          </span>
        )}
      </div>
      <div className="mt-3 h-10 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
            <defs>
              <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={hex} stopOpacity={0.3} />
                <stop offset="100%" stopColor={hex} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              dataKey="v"
              type="monotone"
              stroke={hex}
              strokeWidth={1.5}
              fill={`url(#grad-${label})`}
              isAnimationActive={false}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
