import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import {
  DriveConfigError,
  getBackupFolderId,
  listBackups,
  type BackupFile,
} from '@/lib/backups/drive';
import { BACKUP_RETENTION } from '@/lib/backups/prune';
import { Display, Label, Num, Hair, Body } from '@/components/ui/typography';
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

function relativeAgo(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diff = now - then;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'hoy';
    if (days === 1) return 'ayer';
    if (days < 7) return `hace ${days} días`;
    if (days < 30) return `hace ${Math.floor(days / 7)} sem`;
    return `hace ${Math.floor(days / 30)} meses`;
  } catch {
    return '—';
  }
}

// Compute next Sunday 23:00 AR (= Mon 02:00 UTC).
function nextSundayLabel(): string {
  const now = new Date();
  const day = now.getDay(); // 0 = sun
  const daysUntilNextSun = day === 0 && now.getHours() < 23 ? 0 : (7 - day) % 7 || 7;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntilNextSun);
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(next);
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

  const latest = files[0];

  return (
    <div className="space-y-8">
      {/* ============ HEADER ============ */}
      <header className="flex flex-wrap items-end justify-between gap-6 pt-2">
        <div>
          <Label>Settings · Backups</Label>
          <Display size="lg" className="mt-2 block">
            Backups a Google Drive
          </Display>
          <Body className="mt-2 max-w-2xl">
            Snapshot semanal de toda la base — domingos 23:00 AR. Retención de los{' '}
            <span className="not-italic font-medium text-foreground">{BACKUP_RETENTION}</span>{' '}
            más recientes. Los más viejos se borran automáticamente.
          </Body>
        </div>
        {!configError && <RunNowButton />}
      </header>

      <Hair thick />

      {/* ============ CONFIG ERROR BANNER ============ */}
      {configError && (
        <div
          className="border-l-2 border-[color:var(--attn)] px-5 py-4"
          style={{ background: 'color-mix(in oklab, var(--attn) 8%, transparent)' }}
        >
          <Label style={{ color: 'var(--attn)' }}>Setup pendiente</Label>
          <p className="mt-2 font-display text-base text-foreground">{configError}</p>
          <Body className="mt-2 text-sm">
            Pasos en{' '}
            <code className="font-mono not-italic text-foreground">STATUS.md</code> →{' '}
            <em>Procedimientos administrativos / Backups Drive</em>.
          </Body>
        </div>
      )}

      {/* ============ STATUS STRIP ============ */}
      {!configError && (
        <section>
          <Label>Estado del sistema</Label>
          <div className="mt-3 grid grid-cols-2 gap-px bg-border md:grid-cols-4">
            <StatusCard label="Carpeta Drive" value="gd-finanzas backups" />
            <StatusCard
              label="Último backup"
              value={latest ? relativeAgo(latest.createdTime) : 'sin backups'}
              variant={latest ? 'good' : 'bad'}
            />
            <StatusCard
              label="Próximo programado"
              value={`${nextSundayLabel()} · 23:00`}
              variant="attn"
            />
            <StatusCard label="Retención" value={`${BACKUP_RETENTION} últimos`} />
          </div>
        </section>
      )}

      {/* ============ FILES TABLE ============ */}
      <section>
        <div className="flex items-baseline justify-between">
          <Display size="md">Histórico</Display>
          {files.length > 0 && (
            <Label>
              {files.length} {files.length === 1 ? 'archivo' : 'archivos'} en Drive
            </Label>
          )}
        </div>
        <Hair className="mt-3 mb-1" />

        {files.length === 0 ? (
          <div className="border border-dashed border-border p-10 text-center">
            <Body>
              {configError
                ? 'Configurá las env vars antes de poder listar backups.'
                : (
                  <>
                    Sin backups todavía. Apretá{' '}
                    <span className="not-italic text-foreground">Backup ahora</span> o
                    esperá al cron del próximo domingo.
                  </>
                )}
            </Body>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {['Fecha', 'Archivo', 'Tamaño', 'Drive'].map((h, i) => (
                    <th
                      key={h}
                      className={`px-3 py-2.5 ${i === 2 ? 'text-right' : 'text-left'} font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {files.map((f, i) => (
                  <tr
                    key={f.id}
                    className="border-t border-border/40 transition-colors hover:bg-primary/[0.04]"
                  >
                    <td className="px-3 py-3">
                      <Num className="text-sm text-foreground">{formatDate(f.createdTime)}</Num>
                      <div className="mt-0.5">
                        <Label className="normal-case tracking-[0.05em]">
                          {relativeAgo(f.createdTime)}
                          {i === 0 && (
                            <span
                              className="ml-2 inline-block rounded-full px-1.5 py-[1px] text-[9px]"
                              style={{
                                background: 'color-mix(in oklab, var(--good) 18%, transparent)',
                                color: 'var(--good)',
                              }}
                            >
                              último
                            </span>
                          )}
                        </Label>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Num className="text-xs text-muted-foreground">{f.name}</Num>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Num className="text-sm text-foreground">{formatSize(f.sizeBytes)}</Num>
                    </td>
                    <td className="px-3 py-3">
                      <a
                        href={`https://drive.google.com/file/d/${f.id}/view`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="link font-display text-sm italic text-muted-foreground"
                      >
                        abrir en Drive ↗
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

function StatusCard({
  label,
  value,
  variant = 'foreground',
}: {
  label: string;
  value: string;
  variant?: 'foreground' | 'good' | 'bad' | 'attn';
}) {
  const colorVar =
    variant === 'good'
      ? 'var(--good)'
      : variant === 'bad'
        ? 'var(--bad)'
        : variant === 'attn'
          ? 'var(--attn)'
          : 'var(--foreground)';
  return (
    <div className="bg-card p-5">
      <Label>{label}</Label>
      <div
        className="mt-3 font-display text-xl font-light tabular-nums"
        style={{ color: colorVar }}
      >
        {value}
      </div>
    </div>
  );
}
