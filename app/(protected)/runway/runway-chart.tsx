'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type Point = { month: string; label: string; real: number; tope: number | null };

function axisMillions(value: number): string {
  return `${(value / 1_000_000).toFixed(0)}M`;
}

function tooltipMillions(value: number): string {
  return `$ ${(value / 1_000_000).toFixed(1)}M`;
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function RunwayChart({ data, floor }: { data: Point[]; floor: number | null }) {
  const primary = cssVar('--primary', '#8fb89a');
  const attn = cssVar('--attn', '#c9a96e');
  const bad = cssVar('--bad', '#c0634f');
  const muted = cssVar('--muted-foreground', '#7a7a6a');
  const border = cssVar('--border', 'rgba(0,0,0,0.1)');
  const hasCap = data.some((d) => d.tope !== null);

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={border} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: muted, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={axisMillions}
            tick={{ fill: muted, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip formatter={(v) => tooltipMillions(Number(v))} />
          <Legend />
          <ReferenceLine y={0} stroke={bad} strokeDasharray="4 4" />
          {floor !== null && floor > 0 && (
            <ReferenceLine
              y={floor}
              stroke={attn}
              strokeDasharray="2 4"
              label={{ value: 'buffer', fill: attn, fontSize: 10 }}
            />
          )}
          <Line
            type="monotone"
            dataKey="real"
            name="Ritmo actual"
            stroke={primary}
            strokeWidth={2}
            dot={false}
          />
          {hasCap && (
            <Line
              type="monotone"
              dataKey="tope"
              name="Con tope"
              stroke={attn}
              strokeWidth={2}
              dot={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
