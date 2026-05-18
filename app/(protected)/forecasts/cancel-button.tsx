'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cancelForecast } from '@/app/actions/forecasts/cancel';

type Props = { id: string; recurrenceName: string };

export function CancelForecastButton({ id, recurrenceName }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm(`¿Cancelar esta previsión de "${recurrenceName}"? No se va a regenerar a menos que edites la recurrencia.`)) {
      return;
    }
    const fd = new FormData();
    fd.set('id', id);
    startTransition(async () => {
      const result = await cancelForecast(fd);
      if (result.ok) {
        toast.success('Previsión cancelada');
        router.refresh();
        return;
      }
      if (result.error === 'not_found') {
        toast.error('La previsión no existe o ya no está pendiente');
        return;
      }
      toast.error('No pudimos cancelar. Probá de nuevo.');
    });
  }

  return (
    <Button variant="ghost" size="sm" type="button" onClick={handleClick} disabled={isPending}>
      {isPending ? 'Cancelando…' : 'Cancelar'}
    </Button>
  );
}
