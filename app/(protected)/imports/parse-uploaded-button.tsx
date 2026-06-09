'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { parseImportSync } from '@/app/actions/imports/parse';

/**
 * Parsea en lote los imports en estado 'uploaded'. Usa `parseImportSync` (que
 * AWAITa el parse completo), así el pool acota la **concurrencia real** a `POOL`
 * parses simultáneos — evita disparar N parses en paralelo (rate limits de
 * Anthropic / límites de Hobby) y que el `after()` herede una maxDuration corta.
 * Cada llamada es su request/invocación con los 300s de la ruta `/imports`.
 */
const POOL = 2;

export function ParseUploadedButton({ ids }: { ids: string[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fired, setFired] = useState(false);

  if (ids.length === 0) return null;

  function run() {
    startTransition(async () => {
      const queue = [...ids];
      let ok = 0;
      let fail = 0;
      async function worker() {
        for (;;) {
          const id = queue.shift();
          if (!id) return;
          try {
            const res = await parseImportSync(id);
            if (res.ok) ok += 1;
            else fail += 1;
          } catch {
            fail += 1;
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(POOL, ids.length) }, () => worker()),
      );
      setFired(true);
      if (fail === 0) {
        toast.success(`${ok} ${ok === 1 ? 'import parseado' : 'imports parseados'}`);
      } else {
        toast.warning(`${ok} parseados · ${fail} con error (reintentá los que fallen)`);
      }
      router.refresh();
    });
  }

  return (
    <Button type="button" variant="outline" size="lg" onClick={run} disabled={isPending || fired}>
      {isPending
        ? `Parseando ${ids.length}…`
        : `Parsear ${ids.length} ${ids.length === 1 ? 'subido' : 'subidos'}`}
    </Button>
  );
}
