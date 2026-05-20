import type { BackupFile } from './drive';

/**
 * Determina qué backup files borrar para mantener `keep` los más recientes.
 * Asume que `files` viene ordenado por `createdTime desc` (más reciente
 * primero). Función pura.
 */
export function pruneOldBackups(
  files: readonly BackupFile[],
  keep: number,
): BackupFile[] {
  if (keep < 0) throw new Error('keep must be >= 0');
  if (files.length <= keep) return [];
  return files.slice(keep);
}

export const BACKUP_RETENTION = 12;
