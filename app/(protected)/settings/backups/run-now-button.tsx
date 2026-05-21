'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { runBackupNow } from '@/app/actions/backups/run-now';

export function RunNowButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      size="lg"
      onClick={() => {
        startTransition(async () => {
          const res = await runBackupNow();
          if (res.ok) {
            const delMsg = res.deleted > 0 ? ` · ${res.deleted} viejas borradas` : '';
            toast.success(`Backup creado: ${res.filename}${delMsg}`);
            router.refresh();
          } else {
            toast.error(res.message ?? `Error: ${res.error}`);
          }
        });
      }}
      disabled={isPending}
    >
      {isPending ? 'Ejecutando…' : '↻ Backup ahora'}
    </Button>
  );
}
