import { describe, it, expect } from 'vitest';
import {
  contentTypeForExt,
  extractExtension,
  importCreateMetaSchema,
} from './import';

describe('importCreateMetaSchema', () => {
  it('valida happy path', () => {
    const out = importCreateMetaSchema.safeParse({
      type: 'tc',
      institutionId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(out.success).toBe(true);
  });

  it('rechaza type fuera del enum', () => {
    const out = importCreateMetaSchema.safeParse({
      type: 'invalid',
      institutionId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(out.success).toBe(false);
  });

  it('rechaza institutionId que no es uuid', () => {
    const out = importCreateMetaSchema.safeParse({
      type: 'tc',
      institutionId: 'no-es-uuid',
    });
    expect(out.success).toBe(false);
  });

  it('force opcional', () => {
    const out = importCreateMetaSchema.safeParse({
      type: 'banco',
      institutionId: '550e8400-e29b-41d4-a716-446655440000',
      force: true,
    });
    expect(out.success).toBe(true);
  });
});

describe('extractExtension', () => {
  it('PDF case-insensitive', () => {
    expect(extractExtension('resumen.PDF')).toBe('pdf');
    expect(extractExtension('resumen.pdf')).toBe('pdf');
  });
  it('CSV', () => {
    expect(extractExtension('export.csv')).toBe('csv');
  });
  it('extensión no soportada', () => {
    expect(extractExtension('hoja.xlsx')).toBeNull();
    expect(extractExtension('imagen.png')).toBeNull();
  });
  it('sin extensión', () => {
    expect(extractExtension('archivo')).toBeNull();
  });
});

describe('contentTypeForExt', () => {
  it('pdf', () => expect(contentTypeForExt('pdf')).toBe('application/pdf'));
  it('csv', () => expect(contentTypeForExt('csv')).toBe('text/csv'));
  it('fallback octet-stream', () =>
    expect(contentTypeForExt('xxx')).toBe('application/octet-stream'));
});
