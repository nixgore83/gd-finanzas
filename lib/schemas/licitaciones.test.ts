import { describe, it, expect } from 'vitest';
import {
  parseLunesOverride,
  isPdfFilename,
  lunesOverrideSchema,
  esResultadoParcial,
} from './licitaciones';

describe('esResultadoParcial', () => {
  it('true cuando se procesaron menos de los que se subieron', () => {
    expect(esResultadoParcial(5, 3)).toBe(true);
  });

  it('false cuando salieron todos', () => {
    expect(esResultadoParcial(5, 5)).toBe(false);
  });

  it('true incluso si no salió ninguno (caso borde, el job igual sería error)', () => {
    expect(esResultadoParcial(5, 0)).toBe(true);
  });

  it('null/undefined = no informado (job viejo): no avisa nada', () => {
    expect(esResultadoParcial(5, null)).toBe(false);
    expect(esResultadoParcial(5, undefined)).toBe(false);
  });
});

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
