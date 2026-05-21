'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { EvolutionCurrency, EvolutionSeriesPoint } from '@/lib/reports/evolution';

type Props = {
  data: EvolutionSeriesPoint[];
  currency: EvolutionCurrency;
};

function formatAmount(value: number, currency: EvolutionCurrency): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
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

function resolveColors() {
  if (typeof window === 'undefined') {
    return {
      good: '#7fb091',
      bad: '#d97a4a',
      attn: '#c9a96e',
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
    muted: cs.getPropertyValue('--muted-foreground').trim() || '#7a7a6a',
    border: cs.getPropertyValue('--border').trim() || 'rgba(0,0,0,0.1)',
    foreground: cs.getPropertyValue('--foreground').trim() || '#1b2820',
    card: cs.getPropertyValue('--card').trim() || '#fff',
  };
}

export function EvolutionChart({ data, currency }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center border border-dashed border-border text-sm text-muted-foreground">
        Sin datos para graficar.
      </div>
    );
  }
  const c = resolveColors();
  return (
    <div className="h-80 border border-border bg-card/40 p-4">
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
            contentStyle={{
              background: c.card,
              border: `1px solid ${c.border}`,
              borderRadius: 0,
              fontSize: 11,
              padding: '8px 10px',
              color: c.foreground,
            }}
            cursor={{ fill: 'rgba(143,184,154,0.06)' }}
            formatter={(value, name) => [
              formatAmount(typeof value === 'number' ? value : 0, currency),
              String(name),
            ]}
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
