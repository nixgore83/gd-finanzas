'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { deleteRecurrence } from '@/app/actions/recurrences/delete';

type Props = {
  id: string;
  name: string;
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
  size?: 'sm' | 'default';
};

export function DeleteRecurrenceButton({
  id,
  name,
  variant = 'ghost',
  size = 'sm',
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm(`¿Borrar "${name}"? Las previsiones futuras se borran. Las transacciones que estaban matched quedan sin link.`)) return;
    const fd = new FormData();
    fd.set('id', id);
    startTransition(async () => {
      const result = await deleteRecurrence(fd);
      if (result.ok) {
        toast.success('Recurrencia borrada');
        router.refresh();
        return;
      }
      if (result.error === 'not_found') {
        toast.error('La recurrencia no existe o no es tuya');
        return;
      }
      toast.error('No pudimos borrar. Probá de nuevo.');
    });
  }

  return (
    <Button variant={variant} size={size} type="button" onClick={handleClick} disabled={isPending}>
      {isPending ? 'Borrando…' : 'Borrar'}
    </Button>
  );
}
