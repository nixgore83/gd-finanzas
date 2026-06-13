'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markMonthNoMovements } from '@/app/actions/imports/skip-month';

/**
 * Chip de un mes faltante en "Resúmenes faltantes" con acción "sin movimientos":
 * marca el mes para esa cuenta y lo saca del aviso (cuentas con actividad esporádica).
 */
export function GapMonthChip({
  accountId,
  yearMonth,
  label,
}: {
  accountId: string;
  yearMonth: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);

  return (
    <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-100/60 px-1.5 py-0.5 align-middle text-xs dark:border-amber-700 dark:bg-amber-900/30">
      {label}
      <button
        type="button"
        disabled={pending}
        title="Marcar este mes como sin movimientos para esta cuenta"
        onClick={() =>
          start(async () => {
            setError(false);
            const res = await markMonthNoMovements({ accountId, yearMonth });
            if (res.ok) router.refresh();
            else setError(true);
          })
        }
        className="text-amber-700 underline hover:text-amber-900 disabled:opacity-50 dark:text-amber-300"
      >
        {pending ? '…' : error ? 'error' : 'sin mov.'}
      </button>
    </span>
  );
}
