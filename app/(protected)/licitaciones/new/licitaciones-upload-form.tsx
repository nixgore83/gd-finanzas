'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  LICITACIONES_PDF_CONTENT_TYPE,
  MAX_LICITACIONES_FILE_BYTES,
  MAX_LICITACIONES_PDF_COUNT,
  MAX_LICITACIONES_TOTAL_BYTES,
  isPdfFilename,
} from '@/lib/schemas/licitaciones';
import { createClient } from '@/lib/supabase/client';
import {
  cancelLicitacionJob,
  createLicitacionUploadSlots,
  startLicitacionJob,
} from '@/app/actions/licitaciones/create';

type FileEntry = { id: string; file: File };

export function LicitacionesUploadForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [lunes, setLunes] = useState('');
  const [progress, setProgress] = useState<string | null>(null);

  function addFiles(fileList: FileList) {
    const entries: FileEntry[] = [];
    for (const file of Array.from(fileList)) {
      if (!isPdfFilename(file.name)) {
        toast.error(`"${file.name}" no es un PDF — se ignora.`);
        continue;
      }
      if (file.size > MAX_LICITACIONES_FILE_BYTES) {
        toast.error(`"${file.name}" supera los 20 MB — se ignora.`);
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
    const total = files.reduce((s, f) => s + f.file.size, 0);
    if (total > MAX_LICITACIONES_TOTAL_BYTES) {
      toast.error('El total supera los 50 MB.');
      return;
    }

    startTransition(async () => {
      // 1. Crear el job + obtener un slot de subida (signed URL) por PDF.
      setProgress('Preparando…');
      const slotsRes = await createLicitacionUploadSlots({
        pdfCount: files.length,
        lunes: lunes || null,
      });
      if (!slotsRes.ok) {
        setProgress(null);
        toast.error(
          slotsRes.error === 'session'
            ? 'Sesión expirada — volvé a entrar.'
            : slotsRes.error === 'invalid'
              ? 'Revisá los archivos y la fecha.'
              : 'No se pudo iniciar la subida. Reintentá.',
        );
        return;
      }
      const { jobId, bucket, slots } = slotsRes;

      // 2. Subir cada PDF DIRECTO a Storage con su token (no pasa por la action).
      const supabase = createClient();
      try {
        for (let i = 0; i < files.length; i++) {
          setProgress(`Subiendo ${i + 1} de ${files.length}…`);
          const slot = slots[i]!;
          const { error } = await supabase.storage
            .from(bucket)
            .uploadToSignedUrl(slot.path, slot.token, files[i]!.file, {
              contentType: LICITACIONES_PDF_CONTENT_TYPE,
            });
          if (error) throw error;
        }
      } catch {
        setProgress(null);
        await cancelLicitacionJob(jobId);
        toast.error('Falló la subida de los archivos. Reintentá.');
        return;
      }

      // 3. Cerrar: verifica que estén todos y dispara el procesamiento.
      setProgress('Iniciando procesamiento…');
      const startRes = await startLicitacionJob(jobId);
      if (!startRes.ok) {
        setProgress(null);
        await cancelLicitacionJob(jobId);
        toast.error('No se pudo iniciar el procesamiento. Reintentá.');
        return;
      }

      setProgress(null);
      toast.success('Procesando…');
      router.push(`/licitaciones/${jobId}`);
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

      {progress && <p className="text-sm text-muted-foreground">{progress}</p>}

      <div className="flex justify-end">
        <Button type="button" onClick={submit} disabled={isPending || files.length === 0}>
          {isPending ? 'Subiendo…' : 'Procesar'}
        </Button>
      </div>
    </div>
  );
}
