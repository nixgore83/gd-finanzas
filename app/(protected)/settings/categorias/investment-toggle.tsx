'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { setCategoryInvestment } from '@/app/actions/categories/set-investment';
import { cn } from '@/lib/utils';

/**
 * Toggle pill estilo iOS para marcar categorías como "inversión".
 * - On: track gold/attn, knob oscuro
 * - Off: track muted, knob cream
 * Persiste optimisticamente, con revert si la action falla.
 */
export function InvestmentToggle({
  categoryId,
  initial,
}: {
  categoryId: string;
  initial: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [isPending, startTransition] = useTransition();

  const handleChange = (next: boolean) => {
    const prev = value;
    setValue(next);
    startTransition(async () => {
      const res = await setCategoryInvestment({ categoryId, isInvestment: next });
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
      aria-label={value ? 'Inversión activada' : 'Inversión desactivada'}
      disabled={isPending}
      onClick={() => handleChange(!value)}
      className={cn(
        'relative h-7 w-12 cursor-pointer rounded-full transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        'disabled:cursor-not-allowed disabled:opacity-60',
        value ? 'bg-[color:var(--attn)]' : 'bg-muted',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-1 size-5 rounded-full transition-all',
          value
            ? 'left-6 bg-background shadow-sm'
            : 'left-1 bg-foreground/70',
        )}
      />
    </button>
  );
}
