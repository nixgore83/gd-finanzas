'use client';

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { YearEconomyMonthly } from '@/lib/reports/year-economy';

const MONTH_SHORT = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];

function formatUsd(value: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function axisCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value.toFixed(0)}`;
}

type MonthlyData = YearEconomyMonthly & { label: string };

function withLabels(rows: readonly YearEconomyMonthly[]): MonthlyData[] {
  return rows.map((r) => ({ ...r, label: MONTH_SHORT[r.month - 1] ?? String(r.month) }));
}

/**
 * Recharts no resuelve CSS variables internamente, así que en este componente
 * leemos los tokens del theme una vez en el cliente y los pasamos directo a
 * los SVG props. Si en el futuro cambia el theme en vivo (toggle light/dark)
 * sin remount, habría que mover esto a un useEffect; por ahora alcanza
 * porque los charts se montan cuando entrás a la página.
 */
function resolveThemeColors(): {
  good: string;
  bad: string;
  attn: string;
  primary: string;
  muted: string;
  border: string;
  foreground: string;
  card: string;
} {
  if (typeof window === 'undefined') {
    return {
      good: '#7fb091',
      bad: '#d97a4a',
      attn: '#c9a96e',
      primary: '#8fb89a',
      muted: '#7a7a6a',
      border: 'rgba(143,184,154,0.22)',
      foreground: '#e8e3d4',
      card: '#121b17',
    };
  }
  const cs = getComputedStyle(document.documentElement);
  return {
    good: cs.getPropertyValue('--good').trim() || '#7fb091',
    bad: cs.getPropertyValue('--bad').trim() || '#d97a4a',
    attn: cs.getPropertyValue('--attn').trim() || '#c9a96e',
    primary: cs.getPropertyValue('--primary').trim() || '#8fb89a',
    muted: cs.getPropertyValue('--muted-foreground').trim() || '#7a7a6a',
    border: cs.getPropertyValue('--border').trim() || 'rgba(0,0,0,0.1)',
    foreground: cs.getPropertyValue('--foreground').trim() || '#1b2820',
    card: cs.getPropertyValue('--card').trim() || '#fff',
  };
}

function tooltipStyle(colors: ReturnType<typeof resolveThemeColors>) {
  return {
    background: colors.card,
    border: `1px solid ${colors.border}`,
    borderRadius: 0,
    fontSize: 11,
    padding: '8px 10px',
    color: colors.foreground,
  } as const;
}

export function SavingsChart({
  monthly,
  targetMonthly,
}: {
  monthly: readonly YearEconomyMonthly[];
  targetMonthly: number;
}) {
  const data = withLabels(monthly);
  const c = resolveThemeColors();

  return (
    <div className="h-72 border border-border bg-card/40 p-4">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 24, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={c.border} strokeDasharray="2 4" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: c.muted, fontFamily: 'var(--font-mono)' }}
            axisLine={{ stroke: c.border }}
            tickLine={{ stroke: c.border }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: c.muted, fontFamily: 'var(--font-mono)' }}
            tickFormatter={(v: number) => axisCompact(v)}
            axisLine={{ stroke: c.border }}
            tickLine={{ stroke: c.border }}
            width={70}
          />
          <Tooltip
            contentStyle={tooltipStyle(c)}
            formatter={(value, name) => [
              formatUsd(typeof value === 'number' ? value : 0),
              String(name),
            ]}
            cursor={{ fill: 'rgba(143,184,154,0.06)' }}
          />
          <Legend
            wrapperStyle={{
              fontSize: 10,
              fontFamily: 'var(--font-sans)',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: c.muted,
            }}
          />
          <Bar dataKey="savings" name="Ahorro">
            {data.map((d) => (
              <Cell
                key={d.month}
                fill={c.primary}
                fillOpacity={d.isProjected ? 0.4 : 1}
                stroke={d.isProjected ? c.primary : 'transparent'}
                strokeWidth={d.isProjected ? 1 : 0}
                strokeDasharray={d.isProjected ? '2 2' : '0'}
              />
            ))}
          </Bar>
          <ReferenceLine
            y={targetMonthly}
            stroke={c.attn}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            label={{
              value: `Meta ${formatUsd(targetMonthly)}/mes`,
              fontSize: 10,
              fontFamily: 'var(--font-sans)',
              letterSpacing: '0.14em',
              fill: c.attn,
              position: 'insideTopRight',
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MonthlyChart({ monthly }: { monthly: readonly YearEconomyMonthly[] }) {
  const data = withLabels(monthly);
  const c = resolveThemeColors();

  return (
    <div className="h-72 border border-border bg-card/40 p-4">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={c.border} strokeDasharray="2 4" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: c.muted, fontFamily: 'var(--font-mono)' }}
            axisLine={{ stroke: c.border }}
            tickLine={{ stroke: c.border }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: c.muted, fontFamily: 'var(--font-mono)' }}
            tickFormatter={(v: number) => axisCompact(v)}
            axisLine={{ stroke: c.border }}
            tickLine={{ stroke: c.border }}
            width={70}
          />
          <Tooltip
            contentStyle={tooltipStyle(c)}
            formatter={(value, name) => [
              formatUsd(typeof value === 'number' ? value : 0),
              String(name),
            ]}
            cursor={{ fill: 'rgba(143,184,154,0.06)' }}
          />
          <Legend
            wrapperStyle={{
              fontSize: 10,
              fontFamily: 'var(--font-sans)',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: c.muted,
            }}
          />
          <Bar dataKey="income" name="Ingresos" fill={c.good} />
          <Bar dataKey="expense" name="Gastos" fill={c.bad} />
          <Line
            dataKey="net"
            name="Neto"
            type="monotone"
            stroke={c.attn}
            strokeWidth={2}
            dot={{ r: 3, fill: c.attn, stroke: c.card, strokeWidth: 1 }}
            activeDot={{ r: 5, fill: c.attn, stroke: c.card, strokeWidth: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
