'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  MAX_LICITACIONES_PDF_COUNT,
  isPdfFilename,
} from '@/lib/schemas/licitaciones';
import { createLicitacionJob } from '@/app/actions/licitaciones/create';

const ERROR_MESSAGES: Record<string, string> = {
  session: 'Sesión expirada — volvé a entrar.',
  no_files: 'Adjuntá al menos un PDF.',
  too_many_files: `Máximo ${MAX_LICITACIONES_PDF_COUNT} PDFs por tanda.`,
  file_too_large: 'Algún PDF supera los 20 MB.',
  total_too_large: 'El total supera los 50 MB.',
  unsupported_format: 'Solo se aceptan archivos PDF.',
  storage: 'No se pudieron subir los archivos. Reintentá.',
  unknown: 'Algo falló. Reintentá.',
};

type FileEntry = { id: string; file: File };

export function LicitacionesUploadForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [lunes, setLunes] = useState('');

  function addFiles(fileList: FileList) {
    const entries: FileEntry[] = [];
    for (const file of Array.from(fileList)) {
      if (!isPdfFilename(file.name)) {
        toast.error(`"${file.name}" no es un PDF — se ignora.`);
        continue;
      }
      entries.push({ id: crypto.randomUUID(), file });
    }
    setFiles((prev) => [...prev, ...entries]);
  }

  function removeEntry(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function submit() {
    if (files.length === 0) {
      toast.error('Agregá al menos un PDF.');
      return;
    }
    if (files.length > MAX_LICITACIONES_PDF_COUNT) {
      toast.error(`Máximo ${MAX_LICITACIONES_PDF_COUNT} PDFs por tanda.`);
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      for (const entry of files) formData.append('files', entry.file);
      if (lunes) formData.set('lunes', lunes);

      const res = await createLicitacionJob(formData);
      if (res.ok) {
        toast.success('Procesando…');
        router.push(`/licitaciones/${res.jobId}`);
        return;
      }
      toast.error(ERROR_MESSAGES[res.error] ?? 'Error');
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5 rounded-md border bg-card p-4">
        <Label htmlFor="files">
          PDFs de avisos (suscripción, colocación, complementarios) — hasta{' '}
          {MAX_LICITACIONES_PDF_COUNT}
        </Label>
        <Input
          id="files"
          name="files"
          type="file"
          accept=".pdf"
          multiple
          disabled={isPending}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              addFiles(e.target.files);
              e.target.value = '';
            }
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="space-y-2 rounded-md border bg-card p-4">
          <p className="text-sm font-medium">
            {files.length} {files.length === 1 ? 'archivo' : 'archivos'}
          </p>
          <ul className="space-y-1">
            {files.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate font-mono text-xs">{entry.file.name}</span>
                <button
                  type="button"
                  onClick={() => removeEntry(entry.id)}
                  className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
                  disabled={isPending}
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1.5 rounded-md border bg-card p-4">
        <Label htmlFor="lunes">Lunes objetivo (opcional)</Label>
        <Input
          id="lunes"
          name="lunes"
          type="date"
          value={lunes}
          disabled={isPending}
          onChange={(e) => setLunes(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Vacío = próximo lunes. Forzá la fecha si estás armando una semana distinta.
        </p>
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={submit} disabled={isPending || files.length === 0}>
          {isPending ? 'Subiendo…' : 'Procesar'}
        </Button>
      </div>
    </div>
  );
}
