'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { deleteSnapshot } from '@/app/actions/patrimonio/delete-snapshot';

export function DeleteSnapshotButton({ snapshotId }: { snapshotId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!confirm('Eliminar este snapshot? Esta acción no se puede deshacer.')) return;
    startTransition(async () => {
      const result = await deleteSnapshot(snapshotId);
      if (result.ok) {
        toast.success('Snapshot eliminado');
        router.push('/patrimonio');
      } else {
        toast.error('Error al eliminar');
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={isPending}
      className="border border-[color:var(--bad)]/30 px-5 py-2.5 font-display text-sm text-[color:var(--bad)] transition-colors hover:bg-[color:var(--bad)]/10 disabled:opacity-50"
    >
      {isPending ? 'Eliminando...' : 'Eliminar'}
    </button>
  );
}
