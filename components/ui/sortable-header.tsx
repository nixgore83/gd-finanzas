'use client';

import { cn } from '@/lib/utils';

type Props = {
  label: string;
  field: string;
  currentSort: string | null;
  currentDir: 'asc' | 'desc';
  onSort: (field: string, dir: 'asc' | 'desc') => void;
  className?: string;
};

export function SortableHeader({ label, field, currentSort, currentDir, onSort, className }: Props) {
  const isActive = currentSort === field;
  const nextDir = isActive && currentDir === 'asc' ? 'desc' : 'asc';

  return (
    <button
      type="button"
      onClick={() => onSort(field, isActive ? nextDir : 'asc')}
      className={cn('inline-flex items-center gap-1 hover:text-foreground', className)}
    >
      {label}
      <span className={cn('text-xs', isActive ? 'text-foreground' : 'text-muted-foreground/40')}>
        {isActive ? (currentDir === 'asc' ? '▲' : '▼') : '▲'}
      </span>
    </button>
  );
}
