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

function axisCompact(value: number, currency: EvolutionCurrency): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${currency === 'USD' ? '$' : '$'}${(value / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${currency === 'USD' ? '$' : '$'}${(value / 1_000).toFixed(0)}k`;
  }
  return `${currency === 'USD' ? '$' : '$'}${value.toFixed(0)}`;
}

export function EvolutionChart({ data, currency }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Sin datos para graficar.
      </div>
    );
  }
  return (
    <div className="h-80 rounded-md border bg-card p-3">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="rgba(0,0,0,0.06)" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => axisCompact(v, currency)}
            width={70}
          />
          <Tooltip
            formatter={(value, name) => [
              formatAmount(typeof value === 'number' ? value : 0, currency),
              String(name),
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="income" name="Ingresos" fill="#10b981" radius={[4, 4, 0, 0]} />
          <Bar dataKey="expense" name="Gastos" fill="#ef4444" radius={[4, 4, 0, 0]} />
          <Line
            dataKey="net"
            name="Neto"
            type="monotone"
            stroke="#8b5cf6"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
