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

/**
 * Paleta fallback armónica con el theme Vault Sage:
 * sage / gold / ember / sky / mauve / wheat / moss / brick / periwinkle.
 */
const FALLBACK_PALETTE = [
  '#8fb89a', // sage
  '#c9a96e', // gold
  '#d97a4a', // ember
  '#7fa3b5', // sky
  '#a48bb5', // mauve
  '#d4b85a', // wheat
  '#769d83', // moss
  '#b56b53', // brick
  '#8a9bc4', // periwinkle
];

function colorFor(row: Row, i: number): string {
  if (row.color) return row.color;
  return FALLBACK_PALETTE[i % FALLBACK_PALETTE.length] ?? '#7a7a6a';
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

function resolveCard(): string {
  if (typeof window === 'undefined') return '#121b17';
  return getComputedStyle(document.documentElement).getPropertyValue('--card').trim() || '#121b17';
}

function resolveBorder(): string {
  if (typeof window === 'undefined') return 'rgba(143,184,154,0.22)';
  return (
    getComputedStyle(document.documentElement).getPropertyValue('--border').trim() ||
    'rgba(143,184,154,0.22)'
  );
}

function resolveForeground(): string {
  if (typeof window === 'undefined') return '#e8e3d4';
  return getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim() || '#e8e3d4';
}

export function BreakdownDonut({ rows, total }: Props) {
  if (rows.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center border border-dashed border-border text-sm text-muted-foreground">
        Sin datos para graficar.
      </div>
    );
  }

  const data = rows.map((r) => ({
    name: r.name,
    value: Number.parseFloat(r.amount),
    pct: r.pct,
  }));

  const cardColor = resolveCard();
  const borderColor = resolveBorder();
  const fgColor = resolveForeground();

  return (
    <div className="relative h-80 border border-border bg-card/40 p-4">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="58%"
            outerRadius="88%"
            paddingAngle={1}
            stroke={cardColor}
            strokeWidth={1.5}
          >
            {rows.map((row, i) => (
              <Cell key={row.id} fill={colorFor(row, i)} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: cardColor,
              border: `1px solid ${borderColor}`,
              borderRadius: 0,
              fontSize: 11,
              padding: '8px 10px',
              color: fgColor,
            }}
            formatter={(value, name) => [
              formatUsd(typeof value === 'number' ? String(value) : '0'),
              String(name),
            ]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Total
        </span>
        <span className="mt-1 font-display text-3xl font-semibold tabular-nums text-foreground">
          {formatUsd(total)}
        </span>
      </div>
    </div>
  );
}
