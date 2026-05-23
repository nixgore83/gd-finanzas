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

type DuplicateInfo = { importId: string; confirmedAt: string | null };

export function ImportUploadForm({
  institutions,
  accounts,
}: {
  institutions: Institution[];
  accounts: Account[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<ImportType>('tc');
  const [institutionId, setInstitutionId] = useState<string>(institutions[0]?.id ?? '');
  const [accountId, setAccountId] = useState<string>('');
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);

  const filteredAccounts = accounts.filter((a) => a.institutionId === institutionId);

  function submit(force: boolean) {
    const form = formRef.current;
    if (!form) return;
    const formData = new FormData(form);
    formData.set('type', type);
    formData.set('institutionId', institutionId);
    if (accountId) formData.set('accountId', accountId);
    if (force) formData.set('force', '1');

    startTransition(async () => {
      const res = await createImport(formData);
      if (res.ok) {
        toast.success('Import creado');
        router.push(`/imports/${res.importId}`);
        return;
      }
      if (res.error === 'duplicate' && res.duplicate) {
        setDuplicate(res.duplicate);
        return;
      }
      toast.error(ERROR_MESSAGES[res.error] ?? 'Error');
    });
  }

  return (
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
        <Select value={institutionId} onValueChange={(v) => { setInstitutionId(v); setAccountId(''); }}>
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
        <Label htmlFor="file">Archivo (PDF o CSV, hasta 20 MB)</Label>
        <Input id="file" name="file" type="file" accept=".pdf,.csv" required />
      </div>

      {duplicate && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">
            Este archivo ya fue confirmado anteriormente.
          </p>
          <p className="mt-1 text-amber-800">
            Import existente:{' '}
            <a
              href={`/imports/${duplicate.importId}`}
              className="underline"
            >
              ver
            </a>
            {duplicate.confirmedAt && (
              <> · confirmado el {new Date(duplicate.confirmedAt).toLocaleString('es-AR')}</>
            )}
            .
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => submit(true)}
              disabled={isPending}
            >
              Re-importar igual
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDuplicate(null)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isPending || !institutionId}>
          {isPending ? 'Subiendo…' : 'Subir'}
        </Button>
      </div>
    </form>
  );
}
