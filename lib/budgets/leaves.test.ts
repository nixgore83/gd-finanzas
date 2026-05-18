import { describe, it, expect } from 'vitest';
import { isLeafCategory, leafIdsOf } from './leaves';
import type { CategoryNode } from '@/lib/categories/tree';

const tree: CategoryNode[] = [
  { id: 'sueldo', name: 'Sueldo', kind: 'income', depth: 0, parentId: null },
  { id: 'sueldo-nico', name: 'Sueldo Nico', kind: 'income', depth: 1, parentId: 'sueldo' },
  { id: 'sueldo-pau', name: 'Sueldo Pau', kind: 'income', depth: 1, parentId: 'sueldo' },
  { id: 'otros-ingresos', name: 'Otros ingresos', kind: 'income', depth: 0, parentId: null },
  { id: 'vivienda', name: 'Vivienda', kind: 'expense', depth: 0, parentId: null },
  { id: 'alquiler', name: 'Alquiler', kind: 'expense', depth: 1, parentId: 'vivienda' },
  { id: 'vacaciones', name: 'Vacaciones', kind: 'expense', depth: 0, parentId: null },
];

describe('isLeafCategory', () => {
  it('parent con children → false', () => {
    expect(isLeafCategory('sueldo', tree)).toBe(false);
    expect(isLeafCategory('vivienda', tree)).toBe(false);
  });

  it('child → true', () => {
    expect(isLeafCategory('sueldo-nico', tree)).toBe(true);
    expect(isLeafCategory('alquiler', tree)).toBe(true);
  });

  it('parent sin children → true', () => {
    expect(isLeafCategory('otros-ingresos', tree)).toBe(true);
    expect(isLeafCategory('vacaciones', tree)).toBe(true);
  });

  it('id que no está en el árbol → true (vacuously)', () => {
    expect(isLeafCategory('nope', tree)).toBe(true);
  });
});

describe('leafIdsOf', () => {
  it('devuelve solo las hojas', () => {
    const leaves = leafIdsOf(tree);
    expect(leaves.has('sueldo-nico')).toBe(true);
    expect(leaves.has('sueldo-pau')).toBe(true);
    expect(leaves.has('otros-ingresos')).toBe(true);
    expect(leaves.has('alquiler')).toBe(true);
    expect(leaves.has('vacaciones')).toBe(true);
    expect(leaves.has('sueldo')).toBe(false);
    expect(leaves.has('vivienda')).toBe(false);
  });
});
