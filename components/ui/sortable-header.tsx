'use client';

import { cn } from '@/lib/utils';
import type { SortCriterion } from '@/lib/sorting/criteria';

type Props<F extends string> = {
  label: string;
  field: F;
  criteria: readonly SortCriterion<F>[];
  /** `additive` viene de `event.shiftKey`: shift+click acumula, click reemplaza. */
  onSort: (field: F, additive: boolean) => void;
  className?: string;
};

const SUPERSCRIPTS = ['¹', '²', '³'];

export function SortableHeader<F extends string>({
  label,
  field,
  criteria,
  onSort,
  className,
}: Props<F>) {
  const idx = criteria.findIndex((c) => c.field === field);
  const active = idx >= 0;
  const dir = active ? criteria[idx]!.dir : null;

  return (
    <button
      type="button"
      onClick={(e) => onSort(field, e.shiftKey)}
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault(); // evita selección de texto con shift+click
      }}
      title="Click: ordenar por esta columna · Shift+click: agregar como criterio"
      aria-label={
        active
          ? `${label}: orden ${dir === 'asc' ? 'ascendente' : 'descendente'}${criteria.length >= 2 ? `, prioridad ${idx + 1}` : ''}`
          : `Ordenar por ${label}`
      }
      className={cn('inline-flex select-none items-center gap-1 hover:text-foreground', className)}
    >
      {label}
      <span className={cn('text-xs', active ? 'text-foreground' : 'text-muted-foreground/40')}>
        {active ? (dir === 'asc' ? '▲' : '▼') : '▲'}
        {active && criteria.length >= 2 && (
          <sup className="tabular-nums">{SUPERSCRIPTS[idx] ?? idx + 1}</sup>
        )}
      </span>
    </button>
  );
}
