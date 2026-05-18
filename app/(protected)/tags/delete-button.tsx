'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { deleteTag } from '@/app/actions/tags/delete';

type Props = {
  id: string;
  name: string;
  txCount: number;
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
  size?: 'sm' | 'default';
};

export function DeleteTagButton({ id, name, txCount, variant = 'ghost', size = 'sm' }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    const msg =
      txCount === 0
        ? `¿Borrar "${name}"?`
        : `¿Borrar "${name}"? Se quita de ${txCount} transacción${txCount === 1 ? '' : 'es'}.`;
    if (!confirm(msg)) return;
    const fd = new FormData();
    fd.set('id', id);
    startTransition(async () => {
      const result = await deleteTag(fd);
      if (result.ok) {
        toast.success('Etiqueta borrada');
        router.refresh();
        return;
      }
      if (result.error === 'not_found') {
        toast.error('La etiqueta no existe o no es tuya');
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
