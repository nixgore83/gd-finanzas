'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { processLicitacionesJob } from '@/app/actions/licitaciones/process';
import { esResultadoParcial } from '@/lib/schemas/licitaciones';
import type { LicitacionPdfError } from '@/db/schema/licitaciones';
import { DownloadButton } from './download-button';

const POLL_INTERVAL_MS = 4000;

/**
 * `input_3.pdf` → `PDF #4`. Es lo único que Pau puede mapear al orden en que
 * subió los archivos: no guardamos los nombres originales. Si el nombre no
 * matchea el patrón, lo mostramos crudo.
 */
function etiquetaPdf(nombre: string): string {
  const m = /^input_(\d+)\.pdf$/.exec(nombre);
  return m ? `PDF #${Number(m[1]) + 1}` : nombre;
}

export function JobStatus({
  jobId,
  status,
  stale,
  pdfCount,
  pdfsOk,
  pdfErrors,
}: {
  jobId: string;
  status: 'uploaded' | 'processing' | 'done' | 'error';
  stale: boolean;
  pdfCount: number;
  pdfsOk: number | null;
  pdfErrors: LicitacionPdfError[] | null;
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
    // Tanda parcial: el Excel existe y sirve, pero le faltan instrumentos. No se
    // puede presentar como un éxito limpio — es exactamente lo que pasó
    // desapercibido cuando 2 de 5 PDFs se descartaron en silencio.
    if (esResultadoParcial(status, pdfCount, pdfsOk)) {
      return (
        <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">
            Se procesaron {pdfsOk} de {pdfCount} PDFs. El Excel NO incluye los que fallaron.
          </p>
          {pdfErrors && pdfErrors.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs">
              {pdfErrors.map((e, i) => (
                <li key={`${e.pdf}-${i}`}>
                  <span className="font-medium">{etiquetaPdf(e.pdf)}</span>: {e.error}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs">
            Revisá esos archivos y subilos en una tanda nueva, o reintentá esta.
          </p>
          <div className="flex items-center gap-3">
            <DownloadButton jobId={jobId} size="sm" />
            <Button type="button" size="sm" variant="outline" onClick={retry} disabled={isPending}>
              {isPending ? 'Encolando…' : 'Reintentar'}
            </Button>
          </div>
        </div>
      );
    }

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
