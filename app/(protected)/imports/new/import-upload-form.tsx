'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { IMPORT_TYPES, IMPORT_TYPE_LABELS, type ImportType } from '@/lib/schemas/import';
import { createImport } from '@/app/actions/imports/create';

type Institution = { id: string; name: string };
type Account = { id: string; name: string; institutionId: string | null };

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: 'Revisá los campos del formulario.',
  session: 'Sesión expirada — volvé a entrar.',
  no_file: 'Adjuntá un archivo.',
  file_too_large: 'El archivo supera los 20 MB.',
  unsupported_format: 'Formato no soportado. Usá PDF o CSV.',
  institution_not_found: 'Institución inválida.',
  storage: 'No se pudo subir el archivo. Reintentá.',
  unknown: 'Algo falló. Reintentá.',
};

type UploadResult = {
  fileName: string;
  ok: boolean;
  importId?: string;
  error?: string;
  duplicate?: { importId: string; confirmedAt: string | null };
};

export function ImportUploadForm({
  institutions,
  accounts,
}: {
  institutions: Institution[];
  accounts: Account[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<ImportType>('tc');
  const [institutionId, setInstitutionId] = useState<string>(institutions[0]?.id ?? '');
  const [accountId, setAccountId] = useState<string>('');
  const [results, setResults] = useState<UploadResult[]>([]);
  const [progress, setProgress] = useState<string | null>(null);

  const filteredAccounts = accounts.filter((a) => a.institutionId === institutionId);

  function submit(force: boolean) {
    const fileInput = fileRef.current;
    if (!fileInput?.files || fileInput.files.length === 0) {
      toast.error('Adjuntá al menos un archivo.');
      return;
    }

    const files = Array.from(fileInput.files);

    startTransition(async () => {
      const uploadResults: UploadResult[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        setProgress(`Subiendo ${i + 1} de ${files.length}: ${file.name}`);

        const formData = new FormData();
        formData.set('file', file);
        formData.set('type', type);
        formData.set('institutionId', institutionId);
        if (accountId) formData.set('accountId', accountId);
        if (force) formData.set('force', '1');

        const res = await createImport(formData);
        if (res.ok) {
          uploadResults.push({ fileName: file.name, ok: true, importId: res.importId });
        } else if (res.error === 'duplicate' && res.duplicate) {
          uploadResults.push({ fileName: file.name, ok: false, error: 'duplicate', duplicate: res.duplicate });
        } else {
          uploadResults.push({ fileName: file.name, ok: false, error: ERROR_MESSAGES[res.error] ?? 'Error' });
        }
      }

      setProgress(null);

      const okCount = uploadResults.filter((r) => r.ok).length;
      const failCount = uploadResults.length - okCount;

      if (files.length === 1 && okCount === 1) {
        toast.success('Import creado');
        router.push(`/imports/${uploadResults[0]!.importId}`);
        return;
      }

      if (okCount > 0 && failCount === 0) {
        toast.success(`${okCount} imports creados`);
        router.push('/imports');
        return;
      }

      if (okCount > 0) {
        toast.warning(`${okCount} subidos · ${failCount} con error`);
      }

      setResults(uploadResults);
    });
  }

  const hasDuplicates = results.some((r) => r.error === 'duplicate');

  return (
    <div className="space-y-4">
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
        className="space-y-4 rounded-md border bg-card p-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="institutionId">Institución</Label>
          <Select value={institutionId} onValueChange={(v) => { setInstitutionId(v); setAccountId(''); setResults([]); }}>
            <SelectTrigger id="institutionId">
              <SelectValue placeholder="Elegí una institución" />
            </SelectTrigger>
            <SelectContent>
              {institutions.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="type">Tipo</Label>
          <Select value={type} onValueChange={(v) => setType(v as ImportType)}>
            <SelectTrigger id="type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IMPORT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {IMPORT_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {filteredAccounts.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="accountId">Cuenta (opcional — mejora la selección del parser)</Label>
            <Select
              value={accountId}
              onValueChange={setAccountId}
            >
              <SelectTrigger id="accountId">
                <SelectValue placeholder="Seleccionar cuenta" />
              </SelectTrigger>
              <SelectContent>
                {filteredAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="file">Archivos (PDF o CSV, hasta 20 MB c/u)</Label>
          <Input
            ref={fileRef}
            id="file"
            name="file"
            type="file"
            accept=".pdf,.csv"
            multiple
            required
            onChange={() => setResults([])}
          />
        </div>

        {progress && (
          <p className="text-sm text-muted-foreground">{progress}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={isPending || !institutionId}>
            {isPending ? 'Subiendo…' : 'Subir'}
          </Button>
        </div>
      </form>

      {results.length > 0 && (
        <div className="space-y-2 rounded-md border bg-card p-4">
          <p className="text-sm font-medium">Resultados</p>
          <ul className="space-y-1 text-sm">
            {results.map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className={r.ok ? 'text-emerald-600' : 'text-rose-600'}>
                  {r.ok ? '✓' : '✗'}
                </span>
                <span className="font-mono text-xs">{r.fileName}</span>
                {r.ok && r.importId && (
                  <a href={`/imports/${r.importId}`} className="text-xs text-primary underline">
                    ver
                  </a>
                )}
                {r.error === 'duplicate' && r.duplicate && (
                  <span className="text-xs text-amber-700">
                    duplicado —{' '}
                    <a href={`/imports/${r.duplicate.importId}`} className="underline">
                      ver existente
                    </a>
                  </span>
                )}
                {r.error && r.error !== 'duplicate' && (
                  <span className="text-xs text-rose-600">{r.error}</span>
                )}
              </li>
            ))}
          </ul>
          {hasDuplicates && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => submit(true)}
              disabled={isPending}
            >
              Re-importar duplicados
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
