import { describe, it, expect } from 'vitest';
import { isParseStale, PARSE_STALE_AFTER_MS } from './parse-stale';

describe('isParseStale', () => {
  const now = new Date('2026-06-09T12:00:00Z');

  it('null/undefined → no stale', () => {
    expect(isParseStale(null, now)).toBe(false);
    expect(isParseStale(undefined, now)).toBe(false);
  });

  it('recién arrancado → no stale', () => {
    const started = new Date(now.getTime() - 30_000); // 30s atrás
    expect(isParseStale(started, now)).toBe(false);
  });

  it('justo en el umbral → no stale (estricto >)', () => {
    const started = new Date(now.getTime() - PARSE_STALE_AFTER_MS);
    expect(isParseStale(started, now)).toBe(false);
  });

  it('pasado el umbral → stale', () => {
    const started = new Date(now.getTime() - PARSE_STALE_AFTER_MS - 1000);
    expect(isParseStale(started, now)).toBe(true);
  });

  it('acepta string ISO', () => {
    const started = new Date(now.getTime() - PARSE_STALE_AFTER_MS - 60_000).toISOString();
    expect(isParseStale(started, now)).toBe(true);
  });

  it('fecha inválida → no stale', () => {
    expect(isParseStale('no-es-fecha', now)).toBe(false);
  });
});
