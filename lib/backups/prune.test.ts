import { describe, it, expect } from 'vitest';
import { pruneOldBackups } from './prune';
import type { BackupFile } from './drive';

function mkFile(idx: number): BackupFile {
  return {
    id: `f${idx}`,
    name: `backup-${idx}.zip`,
    createdTime: `2026-05-${20 - idx}T00:00:00.000Z`,
    sizeBytes: 1000,
  };
}

describe('pruneOldBackups', () => {
  it('< keep → no borra', () => {
    const out = pruneOldBackups([mkFile(0), mkFile(1)], 12);
    expect(out).toEqual([]);
  });

  it('= keep → no borra', () => {
    const files = Array.from({ length: 12 }, (_, i) => mkFile(i));
    expect(pruneOldBackups(files, 12)).toEqual([]);
  });

  it('> keep → borra los más viejos', () => {
    const files = Array.from({ length: 15 }, (_, i) => mkFile(i));
    const out = pruneOldBackups(files, 12);
    expect(out).toHaveLength(3);
    // Los más viejos = índices 12,13,14 (porque están ordenados desc)
    expect(out.map((f) => f.id)).toEqual(['f12', 'f13', 'f14']);
  });

  it('keep=0 borra todo', () => {
    expect(pruneOldBackups([mkFile(0), mkFile(1)], 0)).toHaveLength(2);
  });

  it('keep negativo lanza', () => {
    expect(() => pruneOldBackups([], -1)).toThrow();
  });
});
