'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { drainUploadedImports } from '@/app/actions/imports/parse';

/**
 * Botón para parsear en lote los imports en estado 'uploaded'. Una sola llamada a
 * `drainUploadedImports`, que devuelve al instante y procesa el parseo en segundo
 * plano del servidor (secuencial, sobrevive a que navegues). No espera al LLM, así
 * que no cuelga la request ni tira "This page couldn't load".
 *
 * `ids` se usa solo para el conteo del label; el servidor re-consulta los 'uploaded'.
 */
export function ParseUploadedButton({ ids }: { ids: string[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fired, setFired] = useState(false);

  if (ids.length === 0) return null;

  function run() {
    startTransition(async () => {
      try {
        const res = await drainUploadedImports();
        setFired(true);
        if (res.ok) {
          toast.success(
            `${res.queued} ${res.queued === 1 ? 'import puesto' : 'imports puestos'} a parsear · se procesan en segundo plano (recargá para ver el avance)`,
          );
        } else {
          toast.error('No se pudo iniciar el parseo');
        }
        router.refresh();
      } catch {
        toast.error('No se pudo iniciar el parseo');
      }
    });
  }

  return (
    <Button type="button" variant="outline" size="lg" onClick={run} disabled={isPending || fired}>
      {isPending
        ? 'Iniciando…'
        : `Parsear ${ids.length} ${ids.length === 1 ? 'subido' : 'subidos'}`}
    </Button>
  );
}
