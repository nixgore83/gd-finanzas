'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { deleteTransaction } from '@/app/actions/transactions/delete';

type Props = {
  id: string;
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
  size?: 'sm' | 'default';
  label?: string;
  onDeleted?: () => void;
};

export function DeleteTransactionButton({
  id,
  variant = 'ghost',
  size = 'sm',
  label = 'Borrar',
  onDeleted,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm('¿Borrar esta transacción? No se puede deshacer.')) return;
    const fd = new FormData();
    fd.set('id', id);
    startTransition(async () => {
      const result = await deleteTransaction(fd);
      if (result.ok) {
        toast.success('Transacción borrada');
        if (onDeleted) onDeleted();
        else router.refresh();
        return;
      }
      if (result.error === 'not_found') {
        toast.error('La transacción no existe o no es tuya');
        return;
      }
      toast.error('No pudimos borrar. Probá de nuevo.');
    });
  }

  return (
    <Button variant={variant} size={size} type="button" onClick={handleClick} disabled={isPending}>
      {isPending ? 'Borrando…' : label}
    </Button>
  );
}
