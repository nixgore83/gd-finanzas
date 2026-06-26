import { describe, it, expect } from 'vitest';
import { isLicitacionStale, LICITACIONES_STALE_AFTER_MS } from './stale';

describe('isLicitacionStale', () => {
  const now = new Date('2026-06-25T12:00:00Z');

  it('null/undefined → no stale', () => {
    expect(isLicitacionStale(null, now)).toBe(false);
    expect(isLicitacionStale(undefined, now)).toBe(false);
  });

  it('recién arrancado → no stale', () => {
    const started = new Date(now.getTime() - 60 * 1000); // 1 min
    expect(isLicitacionStale(started, now)).toBe(false);
  });

  it('pasado el umbral → stale', () => {
    const started = new Date(now.getTime() - LICITACIONES_STALE_AFTER_MS - 1000);
    expect(isLicitacionStale(started, now)).toBe(true);
  });

  it('justo en el umbral → no stale (estricto >)', () => {
    const started = new Date(now.getTime() - LICITACIONES_STALE_AFTER_MS);
    expect(isLicitacionStale(started, now)).toBe(false);
  });

  it('acepta string ISO', () => {
    const started = new Date(now.getTime() - LICITACIONES_STALE_AFTER_MS - 1000).toISOString();
    expect(isLicitacionStale(started, now)).toBe(true);
  });

  it('fecha inválida → no stale', () => {
    expect(isLicitacionStale('no-es-fecha', now)).toBe(false);
  });
});
