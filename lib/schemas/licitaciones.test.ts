import { describe, it, expect } from 'vitest';
import { parseLunesOverride, isPdfFilename, lunesOverrideSchema } from './licitaciones';

describe('parseLunesOverride', () => {
  it('acepta una fecha válida YYYY-MM-DD', () => {
    expect(parseLunesOverride('2026-05-04')).toBe('2026-05-04');
  });

  it('trimea espacios', () => {
    expect(parseLunesOverride('  2026-05-04  ')).toBe('2026-05-04');
  });

  it('null / vacío → null', () => {
    expect(parseLunesOverride(null)).toBeNull();
    expect(parseLunesOverride('')).toBeNull();
    expect(parseLunesOverride('   ')).toBeNull();
  });

  it('formato inválido → null', () => {
    expect(parseLunesOverride('04/05/2026')).toBeNull();
    expect(parseLunesOverride('2026-5-4')).toBeNull();
    expect(parseLunesOverride('hoy')).toBeNull();
  });

  it('fecha inexistente (2026-02-31) → null', () => {
    expect(parseLunesOverride('2026-02-31')).toBeNull();
  });

  it('no es string (File) → null', () => {
    const f = new File(['x'], 'x.pdf');
    expect(parseLunesOverride(f)).toBeNull();
  });
});

describe('isPdfFilename', () => {
  it('detecta .pdf en cualquier capitalización', () => {
    expect(isPdfFilename('aviso.pdf')).toBe(true);
    expect(isPdfFilename('AVISO.PDF')).toBe(true);
  });
  it('rechaza otros formatos', () => {
    expect(isPdfFilename('aviso.xlsx')).toBe(false);
    expect(isPdfFilename('aviso')).toBe(false);
  });
});

describe('lunesOverrideSchema', () => {
  it('valida fecha real', () => {
    expect(lunesOverrideSchema.safeParse('2026-05-04').success).toBe(true);
  });
  it('rechaza formato malo', () => {
    expect(lunesOverrideSchema.safeParse('4-5-2026').success).toBe(false);
  });
});
