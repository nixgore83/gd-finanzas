'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition } from 'react';
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
import { formatAccount, type AccountForDisplay } from '@/lib/accounts/format';
import {
  applyBulkToEntries,
  importTypeFromAccountType,
  resolveInitialUploadConfig,
  type AccountMeta,
  type BulkApplyFlags,
} from '@/lib/imports/upload-config';
import { createImport } from '@/app/actions/imports/create';

type Institution = { id: string; name: string };
type Account = {
  id: string;
  name: string;
  ownerTag: string | null;
  institutionId: string | null;
  institutionName: string | null;
  type: AccountForDisplay['type'];
  cardBrand: AccountForDisplay['cardBrand'];
  currencyDefault: 'ARS' | 'USD';
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: 'Revisá los campos del formulario.',
  session: 'Sesión expirada — volvé a entrar.',
  no_file: 'Adjuntá un archivo.',
  file_too_large: 'El archivo supera los 20 MB.',
  unsupported_format: 'Formato no soportado. Usá PDF, CSV o XLSX.',
  institution_not_found: 'Institución inválida.',
  storage: 'No se pudo subir el archivo. Reintentá.',
  unknown: 'Algo falló. Reintentá.',
};

type FileEntry = {
  id: string;
  file: File;
  institutionId: string;
  type: ImportType;
  accountId: string;
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
  initialInstitutionId,
  initialAccountId,
}: {
  institutions: Institution[];
  accounts: Account[];
  /** Preselección (link "Importar →" de Resúmenes faltantes): institución/cuenta que se espera importar. */
  initialInstitutionId?: string;
  initialAccountId?: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [progress, setProgress] = useState<string | null>(null);

  // Preselección (link "Importar →" de Resúmenes faltantes): la cuenta manda su
  // institución y tipo. Los archivos nuevos y la barra bulk arrancan cargados con
  // esto, así importar desde ahí no obliga a re-elegir la cuenta.
  const {
    institutionId: defaultInstitutionId,
    type: defaultType,
    accountId: defaultAccountId,
  } = resolveInitialUploadConfig(accounts, {
    initialAccountId,
    initialInstitutionId,
    fallbackInstitutionId: institutions[0]?.id ?? '',
  });

  // Config bulk "aplicar a todos" (visible con ≥2 archivos). Cada campo se
  // propaga solo si su checkbox está tildado (propagación parcial).
  const [bulk, setBulk] = useState<{ institutionId: string; type: ImportType; accountId: string }>({
    institutionId: defaultInstitutionId,
    type: defaultType,
    accountId: defaultAccountId,
  });
  const [bulkFlags, setBulkFlags] = useState<BulkApplyFlags>({
    institution: true,
    type: true,
    account: true,
  });

  const accountMeta = useMemo<AccountMeta>(
    () =>
      Object.fromEntries(
        accounts.map((a) => [
          a.id,
          { institutionId: a.institutionId ?? '', importType: importTypeFromAccountType(a.type) },
        ]),
      ),
    [accounts],
  );

  function updateBulk(patch: Partial<{ institutionId: string; type: ImportType; accountId: string }>) {
    setBulk((b) => {
      const updated = { ...b, ...patch };
      // Cambiar institución invalida la cuenta elegida (mismo criterio por-archivo).
      if (patch.institutionId && patch.institutionId !== b.institutionId) updated.accountId = '';
      return updated;
    });
  }

  function handleBulkAccountChange(accountId: string) {
    const account = accounts.find((a) => a.id === accountId);
    updateBulk(
      account ? { accountId, type: importTypeFromAccountType(account.type) } : { accountId },
    );
  }

  function applyBulk() {
    if (!bulkFlags.institution && !bulkFlags.type && !bulkFlags.account) {
      toast.error('Tildá al menos un campo para aplicar.');
      return;
    }
    setFiles((prev) => applyBulkToEntries(prev, bulk, bulkFlags, accountMeta));
    toast.success(`Aplicado a ${files.length} ${files.length === 1 ? 'archivo' : 'archivos'}`);
  }

  function addFiles(fileList: FileList) {
    const newEntries: FileEntry[] = [];
    const lastEntry = files[files.length - 1];

    for (const file of Array.from(fileList)) {
      newEntries.push({
        id: crypto.randomUUID(),
        file,
        institutionId: lastEntry?.institutionId ?? defaultInstitutionId,
        type: lastEntry?.type ?? defaultType,
        accountId: lastEntry?.accountId ?? defaultAccountId,
      });
    }
    setFiles((prev) => [...prev, ...newEntries]);
    setResults([]);
  }

  function updateEntry(id: string, patch: Partial<Omit<FileEntry, 'id' | 'file'>>) {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        const updated = { ...f, ...patch };
        // Reset accountId when institution changes
        if (patch.institutionId && patch.institutionId !== f.institutionId) {
          updated.accountId = '';
        }
        return updated;
      }),
    );
  }

  function removeEntry(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function handleAccountChange(entryId: string, accountId: string) {
    const account = accounts.find((a) => a.id === accountId);
    if (account) {
      updateEntry(entryId, {
        accountId,
        type: importTypeFromAccountType(account.type),
      });
    } else {
      updateEntry(entryId, { accountId });
    }
  }

  function submit(force: boolean) {
    if (files.length === 0) {
      toast.error('Agregá al menos un archivo.');
      return;
    }

    const missingInstitution = files.some((f) => !f.institutionId);
    if (missingInstitution) {
      toast.error('Seleccioná institución para todos los archivos.');
      return;
    }

    startTransition(async () => {
      const uploadResults: UploadResult[] = [];

      for (let i = 0; i < files.length; i++) {
        const entry = files[i]!;
        setProgress(`Subiendo ${i + 1} de ${files.length}: ${entry.file.name}`);

        const formData = new FormData();
        formData.set('file', entry.file);
        formData.set('type', entry.type);
        formData.set('institutionId', entry.institutionId);
        if (entry.accountId) formData.set('accountId', entry.accountId);
        if (force) formData.set('force', '1');

        const res = await createImport(formData);
        if (res.ok) {
          uploadResults.push({ fileName: entry.file.name, ok: true, importId: res.importId });
        } else if (res.error === 'duplicate' && res.duplicate) {
          uploadResults.push({ fileName: entry.file.name, ok: false, error: 'duplicate', duplicate: res.duplicate });
        } else {
          uploadResults.push({ fileName: entry.file.name, ok: false, error: ERROR_MESSAGES[res.error] ?? 'Error' });
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
      {/* File picker */}
      <div className="space-y-1.5 rounded-md border bg-card p-4">
        <Label htmlFor="file">Archivos (PDF, CSV o XLSX, hasta 20 MB c/u)</Label>
        <Input
          ref={fileRef}
          id="file"
          name="file"
          type="file"
          accept=".pdf,.csv,.xlsx"
          multiple
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              addFiles(e.target.files);
              // Reset input so the same file(s) can be re-added
              e.target.value = '';
            }
          }}
        />
      </div>

      {/* Bulk "aplicar a todos" — solo con ≥2 archivos */}
      {files.length >= 2 && (
        <div className="space-y-3 rounded-md border border-dashed bg-muted/30 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Aplicar a todos los archivos</span>
            <Button type="button" size="sm" onClick={applyBulk} disabled={isPending}>
              Aplicar a {files.length}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Tildá qué campos propagar. Elegir una Cuenta ya define su institución y tipo.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={bulkFlags.institution}
                  onChange={(e) => setBulkFlags((f) => ({ ...f, institution: e.target.checked }))}
                  disabled={isPending}
                />
                Institución
              </label>
              <Select
                value={bulk.institutionId}
                onValueChange={(v) => updateBulk({ institutionId: v })}
                disabled={isPending || !bulkFlags.institution}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Institución" />
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

            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={bulkFlags.type}
                  onChange={(e) => setBulkFlags((f) => ({ ...f, type: e.target.checked }))}
                  disabled={isPending}
                />
                Tipo
              </label>
              <Select
                value={bulk.type}
                onValueChange={(v) => updateBulk({ type: v as ImportType })}
                disabled={isPending || !bulkFlags.type}
              >
                <SelectTrigger className="h-8 text-xs">
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

            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={bulkFlags.account}
                  onChange={(e) => setBulkFlags((f) => ({ ...f, account: e.target.checked }))}
                  disabled={isPending}
                />
                Cuenta
              </label>
              {(() => {
                const bulkAccounts = accounts.filter((a) => a.institutionId === bulk.institutionId);
                return (
                  <Select
                    value={bulk.accountId || '_none'}
                    onValueChange={(v) => handleBulkAccountChange(v === '_none' ? '' : v)}
                    disabled={isPending || !bulkFlags.account || bulkAccounts.length === 0}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder={bulkAccounts.length === 0 ? 'Sin cuentas' : 'Opcional'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Sin especificar</SelectItem>
                      {bulkAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {formatAccount(
                            {
                              institutionName: a.institutionName,
                              type: a.type,
                              cardBrand: a.cardBrand,
                              name: a.name,
                              ownerTag: a.ownerTag ?? '',
                              currency: a.currencyDefault,
                            },
                            { withInstitution: false },
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Per-file configuration */}
      {files.length > 0 && (
        <div className="space-y-3">
          {files.map((entry) => {
            const filteredAccounts = accounts.filter(
              (a) => a.institutionId === entry.institutionId,
            );
            return (
              <div
                key={entry.id}
                className="space-y-3 rounded-md border bg-card p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-sm">{entry.file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeEntry(entry.id)}
                    className="shrink-0 text-sm text-muted-foreground hover:text-destructive"
                    disabled={isPending}
                  >
                    Quitar
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Institución</Label>
                    <Select
                      value={entry.institutionId}
                      onValueChange={(v) => updateEntry(entry.id, { institutionId: v })}
                      disabled={isPending}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Institución" />
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

                  <div className="space-y-1">
                    <Label className="text-xs">Tipo</Label>
                    <Select
                      value={entry.type}
                      onValueChange={(v) => updateEntry(entry.id, { type: v as ImportType })}
                      disabled={isPending}
                    >
                      <SelectTrigger className="h-8 text-xs">
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

                  <div className="space-y-1">
                    <Label className="text-xs">Cuenta</Label>
                    <Select
                      value={entry.accountId || '_none'}
                      onValueChange={(v) => handleAccountChange(entry.id, v === '_none' ? '' : v)}
                      disabled={isPending || filteredAccounts.length === 0}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder={filteredAccounts.length === 0 ? 'Sin cuentas' : 'Opcional'} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">Sin especificar</SelectItem>
                        {filteredAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {formatAccount(
                              {
                                institutionName: a.institutionName,
                                type: a.type,
                                cardBrand: a.cardBrand,
                                name: a.name,
                                ownerTag: a.ownerTag ?? '',
                                currency: a.currencyDefault,
                              },
                              { withInstitution: false },
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            );
          })}

          {progress && (
            <p className="text-sm text-muted-foreground">{progress}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              onClick={() => submit(false)}
              disabled={isPending}
            >
              {isPending
                ? 'Subiendo...'
                : `Subir ${files.length} ${files.length === 1 ? 'archivo' : 'archivos'}`}
            </Button>
          </div>
        </div>
      )}

      {/* Results */}
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
