'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

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

function resolveThemeColors() {
  if (typeof window === 'undefined') {
    return {
      primary: '#8fb89a',
      muted: '#7a7a6a',
      border: 'rgba(143,184,154,0.22)',
      foreground: '#e8e3d4',
      card: '#121b17',
      attn: '#c9a96e',
    };
  }
  const cs = getComputedStyle(document.documentElement);
  return {
    primary: cs.getPropertyValue('--primary').trim() || '#8fb89a',
    muted: cs.getPropertyValue('--muted-foreground').trim() || '#7a7a6a',
    border: cs.getPropertyValue('--border').trim() || 'rgba(0,0,0,0.1)',
    foreground: cs.getPropertyValue('--foreground').trim() || '#1b2820',
    card: cs.getPropertyValue('--card').trim() || '#fff',
    attn: cs.getPropertyValue('--attn').trim() || '#c9a96e',
  };
}

function shortDate(iso: string): string {
  const parts = iso.split('-');
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const mi = Number.parseInt(parts[1]!, 10) - 1;
  return `${months[mi]} ${parts[0]?.slice(2)}`;
}

interface NetWorthChartProps {
  data: { date: string; totalUsd: number }[];
  targetUsd: number;
}

export function NetWorthChart({ data, targetUsd }: NetWorthChartProps) {
  const colors = resolveThemeColors();

  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={data} margin={{ top: 8, right: 18, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={colors.primary} stopOpacity={0.3} />
            <stop offset="95%" stopColor={colors.primary} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={colors.border} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          tick={{ fontSize: 10, fill: colors.muted }}
          axisLine={{ stroke: colors.border }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={axisCompact}
          tick={{ fontSize: 10, fill: colors.muted }}
          axisLine={false}
          tickLine={false}
          width={60}
        />
        <Tooltip
          formatter={(value) => [formatUsd(Number(value)), 'Net worth']}
          labelFormatter={(label) => shortDate(String(label))}
          contentStyle={{
            background: colors.card,
            border: `1px solid ${colors.border}`,
            fontSize: 12,
          }}
        />
        <ReferenceLine
          y={targetUsd}
          stroke={colors.attn}
          strokeDasharray="6 4"
          label={{
            value: `Target ${axisCompact(targetUsd)}`,
            position: 'insideTopRight',
            fill: colors.attn,
            fontSize: 10,
          }}
        />
        <Area
          type="monotone"
          dataKey="totalUsd"
          stroke={colors.primary}
          strokeWidth={2}
          fill="url(#nwGrad)"
          dot={{ r: 3, fill: colors.primary }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
