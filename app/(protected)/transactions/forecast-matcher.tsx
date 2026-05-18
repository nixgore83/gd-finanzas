'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { linkTransactionForecast } from '@/app/actions/forecasts/link';
import { unlinkTransactionForecast } from '@/app/actions/forecasts/unlink';

export type CandidateView = {
  id: string;
  recurrenceName: string;
  expectedDate: string;
  expectedAmount: string;
  currency: 'ARS' | 'USD';
};

type Props =
  | {
      mode: 'candidates';
      transactionId: string;
      candidates: CandidateView[];
    }
  | {
      mode: 'linked';
      transactionId: string;
      recurrenceName: string;
      expectedDate: string;
    };

function formatAmount(amount: string, currency: 'ARS' | 'USD'): string {
  const n = Number.parseFloat(amount);
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

export function ForecastMatcher(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (props.mode === 'linked') {
    function handleUnlink() {
      const fd = new FormData();
      fd.set('transactionId', props.transactionId);
      startTransition(async () => {
        const result = await unlinkTransactionForecast(fd);
        if (result.ok) {
          toast.success('Desvinculada');
          router.refresh();
          return;
        }
        toast.error('No pudimos desvincular. Probá de nuevo.');
      });
    }

    return (
      <div className="rounded-md border border-sky-200 bg-sky-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            <p className="font-medium text-sky-900">
              Linkeada a recurrencia: {props.recurrenceName}
            </p>
            <p className="text-xs text-sky-700">
              Previsión esperada: {props.expectedDate}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={handleUnlink}
            disabled={isPending}
          >
            {isPending ? 'Desvinculando…' : 'Desvincular'}
          </Button>
        </div>
      </div>
    );
  }

  if (props.candidates.length === 0) return null;

  function handleLink(forecastId: string) {
    const fd = new FormData();
    fd.set('transactionId', props.transactionId);
    fd.set('forecastId', forecastId);
    startTransition(async () => {
      const result = await linkTransactionForecast(fd);
      if (result.ok) {
        toast.success('Linkeada');
        router.refresh();
        return;
      }
      if (result.error === 'already_linked') {
        toast.error('La transacción ya está linkeada');
        return;
      }
      toast.error('No pudimos linkear. Probá de nuevo.');
    });
  }

  return (
    <div className="rounded-md border p-4">
      <h2 className="mb-2 text-sm font-medium">Previsiones candidatas</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Estas previsiones de recurrencias podrían corresponder a esta transacción (mismo monto ±10%
        en USD, ±5 días).
      </p>
      <ul className="space-y-2">
        {props.candidates.map((c) => (
          <li
            key={c.id}
            className="flex items-center justify-between gap-3 rounded border bg-muted/30 px-3 py-2 text-sm"
          >
            <div>
              <p className="font-medium">{c.recurrenceName}</p>
              <p className="text-xs text-muted-foreground">
                {c.expectedDate} · {formatAmount(c.expectedAmount, c.currency)}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => handleLink(c.id)}
              disabled={isPending}
            >
              {isPending ? 'Linkeando…' : 'Linkear'}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
