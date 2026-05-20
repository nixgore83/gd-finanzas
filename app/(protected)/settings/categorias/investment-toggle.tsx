'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { setCategoryInvestment } from '@/app/actions/categories/set-investment';

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
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => handleChange(e.target.checked)}
        disabled={isPending}
        className="size-4 rounded border-input"
      />
      <span className="text-xs text-muted-foreground">Inversión</span>
    </label>
  );
}
