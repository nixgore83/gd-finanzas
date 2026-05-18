'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

type Row = {
  id: string;
  name: string;
  color: string | null;
  amount: string;
  pct: number;
};

type Props = {
  rows: Row[];
  total: string;
};

// Paleta fallback cíclica para categorías sin color asignado.
const FALLBACK_PALETTE = [
  '#6366f1',
  '#f97316',
  '#06b6d4',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#64748b',
  '#f59e0b',
  '#3b82f6',
  '#71717a',
];

function colorFor(row: Row, i: number): string {
  if (row.color) return row.color;
  return FALLBACK_PALETTE[i % FALLBACK_PALETTE.length] ?? '#94a3b8';
}

function formatUsd(amount: string): string {
  const n = Number.parseFloat(amount);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export function BreakdownDonut({ rows, total }: Props) {
  if (rows.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Sin datos para graficar.
      </div>
    );
  }

  const data = rows.map((r) => ({
    name: r.name,
    value: Number.parseFloat(r.amount),
    pct: r.pct,
  }));

  return (
    <div className="relative h-72">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="55%"
            outerRadius="85%"
            paddingAngle={1}
            stroke="white"
          >
            {rows.map((row, i) => (
              <Cell key={row.id} fill={colorFor(row, i)} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [
              formatUsd(typeof value === 'number' ? String(value) : '0'),
              String(name),
            ]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-xs text-muted-foreground">Total</span>
        <span className="text-xl font-semibold tabular-nums">{formatUsd(total)}</span>
      </div>
    </div>
  );
}
