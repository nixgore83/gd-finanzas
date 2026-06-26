'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getLicitacionDownloadUrl } from '@/app/actions/licitaciones/get-download-url';

const ERROR_MESSAGES: Record<string, string> = {
  session: 'Sesión expirada — volvé a entrar.',
  not_found: 'No se encontró el job.',
  not_ready: 'El Excel todavía no está listo.',
  storage: 'No se pudo generar el link. Reintentá.',
};

export function DownloadButton({
  jobId,
  size = 'default',
}: {
  jobId: string;
  size?: 'default' | 'sm';
}) {
  const [isPending, startTransition] = useTransition();

  function download() {
    startTransition(async () => {
      const res = await getLicitacionDownloadUrl(jobId);
      if (res.ok) {
        window.open(res.url, '_blank', 'noopener,noreferrer');
      } else {
        toast.error(ERROR_MESSAGES[res.error] ?? 'Error');
      }
    });
  }

  return (
    <Button type="button" size={size} onClick={download} disabled={isPending}>
      {isPending ? 'Generando…' : 'Descargar Excel'}
    </Button>
  );
}
