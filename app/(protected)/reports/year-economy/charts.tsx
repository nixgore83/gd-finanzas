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
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
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

export function SavingsChart({
  monthly,
  targetMonthly,
}: {
  monthly: readonly YearEconomyMonthly[];
  targetMonthly: number;
}) {
  const data = withLabels(monthly);
  return (
    <div className="h-72 rounded-md border bg-card p-3">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="rgba(0,0,0,0.06)" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => axisCompact(v)}
            width={70}
          />
          <Tooltip
            formatter={(value, name) => [
              formatUsd(typeof value === 'number' ? value : 0),
              String(name),
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="savings" name="Ahorro" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.month} fill={d.isProjected ? '#a5b4fc' : '#4f46e5'} />
            ))}
          </Bar>
          <ReferenceLine
            y={targetMonthly}
            stroke="#0ea5e9"
            strokeDasharray="4 4"
            label={{ value: `Target ${formatUsd(targetMonthly)}/mes`, fontSize: 11, position: 'insideTopRight' }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MonthlyChart({ monthly }: { monthly: readonly YearEconomyMonthly[] }) {
  const data = withLabels(monthly);
  return (
    <div className="h-72 rounded-md border bg-card p-3">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="rgba(0,0,0,0.06)" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => axisCompact(v)}
            width={70}
          />
          <Tooltip
            formatter={(value, name) => [
              formatUsd(typeof value === 'number' ? value : 0),
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
