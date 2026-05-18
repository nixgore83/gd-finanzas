'use client';

import Link from 'next/link';
import { Label } from '@/components/ui/label';

export type TagOption = { id: string; name: string; color: string | null };

type Props = {
  tags: TagOption[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
};

const DEFAULT_BG = 'rgb(243 244 246)'; // gray-100
const DEFAULT_BORDER = 'rgb(209 213 219)'; // gray-300
const DEFAULT_FG = 'rgb(55 65 81)'; // gray-700

function tinted(color: string, alpha: number): string {
  // Convert #rrggbb to rgba(...) for selected chip background.
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m || !m[1] || !m[2] || !m[3]) return color;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function TagMultiSelect({ tags, value, onChange, disabled }: Props) {
  function toggle(id: string) {
    if (disabled) return;
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else onChange([...value, id]);
  }

  if (tags.length === 0) {
    return (
      <div className="space-y-2">
        <Label>Etiquetas</Label>
        <p className="text-sm text-muted-foreground">
          No hay etiquetas todavía.{' '}
          <Link href="/tags/new" className="underline">
            Crear la primera
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label>Etiquetas</Label>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => {
          const selected = value.includes(tag.id);
          const baseColor = tag.color;
          const style: React.CSSProperties = selected
            ? {
                backgroundColor: baseColor ? tinted(baseColor, 0.18) : DEFAULT_BG,
                borderColor: baseColor ?? DEFAULT_BORDER,
                color: baseColor ?? DEFAULT_FG,
              }
            : {
                backgroundColor: 'transparent',
                borderColor: 'rgb(229 231 235)', // gray-200
                color: 'rgb(107 114 128)', // gray-500
              };
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggle(tag.id)}
              disabled={disabled}
              style={style}
              className="rounded-full border px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
              aria-pressed={selected}
            >
              {tag.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
