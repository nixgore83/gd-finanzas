'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { linkAsTransfer, type LinkTransferResult } from '@/app/actions/transactions/link-transfer';

export type TransferLinkCandidateView = {
  id: string;
  date: string;
  accountName: string;
  amountOriginal: string;
  currencyOriginal: 'ARS' | 'USD';
  description: string;
};

type Props = {
  transactionId: string;
  candidates: TransferLinkCandidateView[];
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

const ERROR_MSG: Record<string, string> = {
  already_paired: 'Alguna de las dos ya está en un par.',
  same_account: 'Son de la misma cuenta — no es una transferencia.',
  same_direction: 'Las dos van en el mismo sentido (no se pueden parear).',
  forecast_linked: 'Una está linkeada a una previsión — desvinculala primero.',
};

export function TransferLinker({ transactionId, candidates }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleLink(candidateId: string) {
    startTransition(async () => {
      const res: LinkTransferResult = await linkAsTransfer({ aId: transactionId, bId: candidateId });
      if (res.ok) {
        toast.success('Linkeadas como transferencia');
        router.refresh();
        return;
      }
      toast.error(ERROR_MSG[res.error] ?? 'No pudimos linkear. Probá de nuevo.');
    });
  }

  return (
    <div className="rounded-md border p-4">
      <h2 className="mb-2 text-sm font-medium">Candidatos para parear</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Movimientos de otras cuentas, en sentido opuesto y dentro de ±7 días. Elegí el otro lado
        de esta transferencia (ej. la pata en USD de una compra de dólares). Cada pata conserva su
        moneda y monto.
      </p>
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay candidatos cerca. Podés cargarlo manualmente o ajustar la fecha del otro extracto.
        </p>
      ) : (
        <ul className="space-y-2">
          {candidates.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 rounded border bg-muted/30 px-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium">{c.accountName}</p>
                <p className="text-xs text-muted-foreground">
                  {c.date} · {formatAmount(c.amountOriginal, c.currencyOriginal)} · {c.description}
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
      )}
    </div>
  );
}
