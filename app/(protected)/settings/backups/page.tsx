import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { DriveConfigError, getBackupFolderId, listBackups, type BackupFile } from '@/lib/backups/drive';
import { BACKUP_RETENTION } from '@/lib/backups/prune';
import { SettingsNav } from '../settings-nav';
import { RunNowButton } from './run-now-button';

export const metadata = {
  title: 'Backups · gd-finanzas',
};

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('es-AR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default async function BackupsPage() {
  try {
    await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  let files: BackupFile[] = [];
  let configError: string | null = null;
  let folderId: string | null = null;

  try {
    folderId = getBackupFolderId();
    files = await listBackups(folderId);
  } catch (err) {
    if (err instanceof DriveConfigError) {
      configError = err.message;
    } else {
      throw err;
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <SettingsNav active="backups" />
      <div>
        <h1 className="text-2xl font-semibold">Backups</h1>
        <p className="text-sm text-muted-foreground">
          Backup semanal a Google Drive con CSVs por tabla + dump JSON. Retención:{' '}
          {BACKUP_RETENTION} backups más recientes.
        </p>
      </div>

      {configError && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Setup pendiente</p>
          <p>{configError}</p>
          <p className="mt-1 text-xs">
            Pasos en STATUS.md sección &ldquo;Procedimientos administrativos / Backups
            Drive&rdquo;.
          </p>
        </div>
      )}

      {!configError && (
        <div className="flex items-center justify-between rounded-md border bg-card p-4">
          <div>
            <p className="text-sm font-medium">Ejecutar backup manual</p>
            <p className="text-xs text-muted-foreground">
              Útil para validar el setup o forzar un backup post-cambios grandes.
            </p>
          </div>
          <RunNowButton />
        </div>
      )}

      <section>
        <h2 className="mb-2 text-base font-semibold">Archivos en Drive</h2>
        {files.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {configError
              ? 'Configurá las env vars antes de poder listar backups.'
              : 'Sin backups todavía. Apretá "Backup ahora" o esperá al cron del próximo domingo.'}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Nombre</th>
                  <th className="px-3 py-2 font-medium">Creado</th>
                  <th className="px-3 py-2 text-right font-medium">Tamaño</th>
                  <th className="px-3 py-2 font-medium">Drive</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id} className="border-t">
                    <td className="px-3 py-1.5 font-mono text-xs">{f.name}</td>
                    <td className="px-3 py-1.5 tabular-nums">{formatDate(f.createdTime)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatSize(f.sizeBytes)}
                    </td>
                    <td className="px-3 py-1.5">
                      <a
                        href={`https://drive.google.com/file/d/${f.id}/view`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        abrir →
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
