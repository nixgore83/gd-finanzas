import { describe, it, expect } from 'vitest';
import { categoryFilterSchema } from './category-filter';

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('categoryFilterSchema', () => {
  it('acepta un uuid de categoría', () => {
    const res = categoryFilterSchema.safeParse(UUID);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data).toBe(UUID);
  });

  it('acepta el literal "unclassified"', () => {
    const res = categoryFilterSchema.safeParse('unclassified');
    expect(res.success).toBe(true);
    if (res.success) expect(res.data).toBe('unclassified');
  });

  it('rechaza un string arbitrario que no es uuid', () => {
    expect(categoryFilterSchema.safeParse('todas').success).toBe(false);
    expect(categoryFilterSchema.safeParse('unclass').success).toBe(false);
  });

  it('rechaza string vacío', () => {
    expect(categoryFilterSchema.safeParse('').success).toBe(false);
  });

  it('rechaza undefined (sin filtro se resuelve como .optional() en el caller)', () => {
    expect(categoryFilterSchema.safeParse(undefined).success).toBe(false);
  });

  it('rechaza un uuid mal formado', () => {
    expect(categoryFilterSchema.safeParse('3f2504e0-0000').success).toBe(false);
  });

  it('optional() deja pasar undefined sin filtro', () => {
    const res = categoryFilterSchema.optional().safeParse(undefined);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data).toBeUndefined();
  });
});
