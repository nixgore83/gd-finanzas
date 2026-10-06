'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { setCategoryInvestment } from '@/app/actions/categories/set-investment';
import { setCategoryHouseholdExclusion } from '@/app/actions/categories/set-household-exclusion';
import { cn } from '@/lib/utils';

/**
 * Toggle pill estilo iOS para los flags de una categoría: "inversión" (suma al
 * ahorro en el Reporte D) o "fuera de la casa" (no cuenta como gasto del hogar).
 * - On: track gold/attn, knob oscuro
 * - Off: track muted, knob cream
 * Persiste optimisticamente, con revert si la action falla.
 */
export function InvestmentToggle({
  categoryId,
  initial,
  flag = 'investment',
}: {
  categoryId: string;
  initial: boolean;
  flag?: 'investment' | 'household';
}) {
  const [value, setValue] = useState(initial);
  const [isPending, startTransition] = useTransition();

  const handleChange = (next: boolean) => {
    const prev = value;
    setValue(next);
    startTransition(async () => {
      const res =
        flag === 'investment'
          ? await setCategoryInvestment({ categoryId, isInvestment: next })
          : await setCategoryHouseholdExclusion({ categoryId, excluded: next });
      if (!res.ok) {
        setValue(prev);
        toast.error('No se pudo actualizar');
      }
    });
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={
        flag === 'investment'
          ? value
            ? 'Inversión activada'
            : 'Inversión desactivada'
          : value
            ? 'Fuera del gasto de la casa'
            : 'Dentro del gasto de la casa'
      }
      disabled={isPending}
      onClick={() => handleChange(!value)}
      className={cn(
        'relative h-7 w-12 cursor-pointer rounded-full transition-colors',
        'focus-visible:ring-primary/50 focus:outline-none focus-visible:ring-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        value
          ? flag === 'investment'
            ? 'bg-[color:var(--attn)]'
            : 'bg-[color:var(--bad)]'
          : 'bg-muted',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-1 size-5 rounded-full transition-all',
          value ? 'bg-background left-6 shadow-sm' : 'bg-foreground/70 left-1',
        )}
      />
    </button>
  );
}
