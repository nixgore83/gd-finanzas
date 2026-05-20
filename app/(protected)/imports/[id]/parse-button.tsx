'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { parseImport } from '@/app/actions/imports/parse';

export function ParseButton({ importId }: { importId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      onClick={() => {
        startTransition(async () => {
          const res = await parseImport(importId);
          if (res.ok) {
            toast.success(`Parser OK · ${res.lineCount} líneas`);
            router.refresh();
          } else {
            toast.error(res.message ?? `Error: ${res.error}`);
            router.refresh();
          }
        });
      }}
      disabled={isPending}
    >
      {isPending ? 'Parseando…' : 'Parsear con LLM'}
    </Button>
  );
}
