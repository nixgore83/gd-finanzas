import { describe, it, expect } from 'vitest';
import { tagInputSchema, tagIdsSchema, parseTagFormData } from './tag';

describe('tagInputSchema', () => {
  it('happy path', () => {
    const out = tagInputSchema.parse({ name: 'Rabbit Hole', color: '#ff8800' });
    expect(out.name).toBe('Rabbit Hole');
    expect(out.color).toBe('#ff8800');
  });

  it('trim del name + lowercase del color', () => {
    const out = tagInputSchema.parse({ name: '  Pau  ', color: '#FF8800' });
    expect(out.name).toBe('Pau');
    expect(out.color).toBe('#ff8800');
  });

  it('color vacío / null / undefined → null', () => {
    expect(tagInputSchema.parse({ name: 'x', color: '' }).color).toBeNull();
    expect(tagInputSchema.parse({ name: 'x', color: '   ' }).color).toBeNull();
    expect(tagInputSchema.parse({ name: 'x', color: null }).color).toBeNull();
    expect(tagInputSchema.parse({ name: 'x' }).color).toBeNull();
  });

  it('rechaza name vacío / > 50', () => {
    expect(() => tagInputSchema.parse({ name: '' })).toThrow();
    expect(() => tagInputSchema.parse({ name: 'x'.repeat(51) })).toThrow();
  });

  it('rechaza color hex inválido', () => {
    expect(() => tagInputSchema.parse({ name: 'x', color: '#abc' })).toThrow();
    expect(() => tagInputSchema.parse({ name: 'x', color: 'red' })).toThrow();
    expect(() => tagInputSchema.parse({ name: 'x', color: '#zzzzzz' })).toThrow();
  });
});

describe('tagIdsSchema', () => {
  const A = '00000000-0000-0000-0000-000000000001';
  const B = '00000000-0000-0000-0000-000000000002';

  it('parsea array de uuids', () => {
    expect(tagIdsSchema.parse([A, B])).toEqual([A, B]);
  });

  it('dedupea duplicados', () => {
    expect(tagIdsSchema.parse([A, B, A])).toEqual([A, B]);
  });

  it('rechaza items no-uuid', () => {
    expect(() => tagIdsSchema.parse([A, 'not-uuid'])).toThrow();
  });

  it('rechaza > 20 items', () => {
    const arr = Array.from({ length: 21 }, (_, i) =>
      `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    );
    expect(() => tagIdsSchema.parse(arr)).toThrow();
  });

  it('acepta array vacío', () => {
    expect(tagIdsSchema.parse([])).toEqual([]);
  });
});

describe('parseTagFormData', () => {
  it('parsea name + color', () => {
    const fd = new FormData();
    fd.set('name', 'Test');
    fd.set('color', '#abcdef');
    const out = parseTagFormData(fd);
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.name).toBe('Test');
      expect(out.data.color).toBe('#abcdef');
    }
  });

  it('wipeColor=1 fuerza color a null aunque venga un valor', () => {
    const fd = new FormData();
    fd.set('name', 'Test');
    fd.set('color', '#abcdef');
    fd.set('wipeColor', '1');
    const out = parseTagFormData(fd);
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.color).toBeNull();
  });
});
