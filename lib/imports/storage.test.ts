import { describe, it, expect } from 'vitest';
import { buildImportPath, hashBytes } from './storage';

describe('buildImportPath', () => {
  it('compone household/importId.ext', () => {
    expect(buildImportPath('hh-1', 'imp-2', 'pdf')).toBe('hh-1/imp-2.pdf');
  });
  it('sanitiza la extensión', () => {
    expect(buildImportPath('hh-1', 'imp-2', 'PDF')).toBe('hh-1/imp-2.pdf');
    expect(buildImportPath('hh-1', 'imp-2', '.csv')).toBe('hh-1/imp-2.csv');
  });
});

describe('hashBytes', () => {
  it('mismo contenido → mismo hash', async () => {
    const a = new TextEncoder().encode('hello');
    const b = new TextEncoder().encode('hello');
    expect(await hashBytes(a)).toBe(await hashBytes(b));
  });
  it('contenido distinto → hash distinto', async () => {
    const a = new TextEncoder().encode('hello');
    const b = new TextEncoder().encode('world');
    expect(await hashBytes(a)).not.toBe(await hashBytes(b));
  });
  it('hex 64 chars (SHA-256)', async () => {
    const a = new TextEncoder().encode('cualquier cosa');
    const h = await hashBytes(a);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
