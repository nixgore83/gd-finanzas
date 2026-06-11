'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { deleteImport } from '@/app/actions/imports/delete';

/**
 * Borra el import desde su página de detalle. Solo se renderiza para estados
 * borrables (`DELETABLE_STATUSES`); el action vuelve a validar server-side.
 */
export function DeleteImportButton({ importId }: { importId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function doDelete() {
    if (!confirm('Borrar este import? No se puede deshacer.')) return;
    startTransition(async () => {
      const res = await deleteImport({ id: importId });
      if (res.ok && res.deleted > 0) {
        toast.success('Import borrado');
        router.push('/imports');
        router.refresh();
      } else if (res.ok) {
        toast.error('No se borró (estado no borrable)');
      } else {
        toast.error(`Error al borrar: ${res.error}`);
      }
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={doDelete}
      disabled={isPending}
      className="text-[color:var(--bad)] hover:text-[color:var(--bad)]"
    >
      Borrar import
    </Button>
  );
}
