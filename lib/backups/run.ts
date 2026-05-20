import { loadHouseholdSnapshot } from './snapshot';
import { buildBackupZip } from './build-zip';
import {
  deleteFile,
  getBackupFolderId,
  listBackups,
  uploadBackup,
  type BackupFile,
} from './drive';
import { pruneOldBackups, BACKUP_RETENTION } from './prune';

export type BackupRunResult = {
  uploaded: BackupFile;
  deleted: BackupFile[];
  totalAfter: number;
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Orquesta el backup completo: snapshot → zip → upload → prune.
 * Compartido entre el cron (Bearer auth) y la server action de "Backup ahora"
 * en `/settings/backups` (cookie auth). El caller hace su propia validación
 * de auth antes de llamar.
 */
export async function runBackup(householdId: string): Promise<BackupRunResult> {
  const folderId = getBackupFolderId();
  const snapshot = await loadHouseholdSnapshot(householdId);
  const bytes = await buildBackupZip(snapshot);

  // Filename con sufijo numérico si hay colisión el mismo día.
  const existing = await listBackups(folderId);
  const base = `gd-finanzas-backup-${todayIso()}`;
  const taken = new Set(existing.map((f) => f.name.replace(/\.zip$/, '')));
  let candidate = base;
  let suffix = 1;
  while (taken.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  const filename = `${candidate}.zip`;

  const uploaded = await uploadBackup({ name: filename, bytes, folderId });

  // Prune: re-list para incluir el recién subido en orden por createdTime.
  const after = await listBackups(folderId);
  const toDelete = pruneOldBackups(after, BACKUP_RETENTION);
  for (const f of toDelete) {
    await deleteFile(f.id);
  }

  return {
    uploaded,
    deleted: toDelete,
    totalAfter: after.length - toDelete.length,
  };
}
