'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { parseImport } from '@/app/actions/imports/parse';

/**
 * Dispara el parseo de TODOS los imports en estado 'uploaded'. Cada `parseImport`
 * es su propia request/invocación (con sus 300s), así que en vez de batchear en una
 * sola función (que reventaría el límite) se disparan N requests. Pool acotado para
 * no mandar una ráfaga de N a la vez.
 */
const POOL = 3;

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
            const res = await parseImport(id);
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
        toast.success(`${ok} ${ok === 1 ? 'import puesto' : 'imports puestos'} a parsear`);
      } else {
        toast.warning(`${ok} a parsear · ${fail} no se pudieron disparar`);
      }
      router.refresh();
    });
  }

  return (
    <Button type="button" variant="outline" size="lg" onClick={run} disabled={isPending || fired}>
      {isPending
        ? 'Disparando…'
        : `Parsear ${ids.length} ${ids.length === 1 ? 'subido' : 'subidos'}`}
    </Button>
  );
}
