'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { processLicitacionesJob } from '@/app/actions/licitaciones/process';
import { DownloadButton } from './download-button';

const POLL_INTERVAL_MS = 4000;

export function JobStatus({
  jobId,
  status,
  stale,
}: {
  jobId: string;
  status: 'uploaded' | 'processing' | 'done' | 'error';
  stale: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Polling: mientras procesa (y no se cortó), refrescá el server component para
  // ver el cambio de estado. router.refresh() no remonta, solo re-fetchea.
  useEffect(() => {
    if (status !== 'processing' || stale) return;
    const t = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [status, stale, router]);

  function retry() {
    startTransition(async () => {
      const res = await processLicitacionesJob(jobId);
      if (res.ok) {
        toast.success('Reintentando…');
        router.refresh();
      } else {
        toast.error(res.error === 'session' ? 'Sesión expirada.' : 'No se pudo reintentar.');
      }
    });
  }

  if (status === 'done') {
    return (
      <div className="flex items-center gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
        <span className="font-medium">Listo.</span>
        <DownloadButton jobId={jobId} size="sm" />
      </div>
    );
  }

  if (status === 'processing' && !stale) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium">Procesando… (llamando a Claude)</p>
        <p className="mt-1 text-xs">
          Esto puede tardar hasta un par de minutos. La página se actualiza sola.
        </p>
      </div>
    );
  }

  // 'uploaded', 'error', o 'processing' cortado (stale): ofrecé (re)procesar.
  const cortado = status === 'processing' && stale;
  return (
    <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      {cortado && (
        <p className="font-medium">
          El procesamiento se cortó (excedió el límite de tiempo). Reintentá.
        </p>
      )}
      {status === 'uploaded' && <p>Archivos subidos. Iniciá el procesamiento.</p>}
      {status === 'error' && <p className="font-medium">Falló el procesamiento.</p>}
      <Button type="button" size="sm" onClick={retry} disabled={isPending}>
        {isPending ? 'Encolando…' : status === 'uploaded' ? 'Procesar' : 'Reintentar'}
      </Button>
    </div>
  );
}
