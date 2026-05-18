import { describe, it, expect } from 'vitest';
import { rollupBuckets, type BreakdownInput } from './breakdown';

const buckets: BreakdownInput[] = [
  // Vivienda > Alquiler
  {
    id: 'alquiler',
    parentId: 'vivienda',
    name: 'Alquiler',
    parentName: 'Vivienda',
    color: null,
    parentColor: '#6366f1',
    amount: '500',
  },
  {
    id: 'expensas',
    parentId: 'vivienda',
    name: 'Expensas',
    parentName: 'Vivienda',
    color: null,
    parentColor: '#6366f1',
    amount: '120',
  },
  // Alimentación > Supermercado
  {
    id: 'super',
    parentId: 'alimentacion',
    name: 'Supermercado',
    parentName: 'Alimentación',
    color: null,
    parentColor: '#f97316',
    amount: '300',
  },
  // Vacaciones (leaf parent — no children)
  {
    id: 'vacaciones',
    parentId: null,
    name: 'Vacaciones',
    parentName: null,
    color: '#14b8a6',
    parentColor: null,
    amount: '200',
  },
];

describe('rollupBuckets', () => {
  it('level=leaf devuelve buckets sin tocar, ordenados desc', () => {
    const { total, rows } = rollupBuckets(buckets, 'leaf');
    expect(total).toBe('1120.00');
    expect(rows.map((r) => r.id)).toEqual(['alquiler', 'super', 'vacaciones', 'expensas']);
    const alq = rows.find((r) => r.id === 'alquiler')!;
    expect(alq.amount).toBe('500.00');
    expect(alq.pct).toBeCloseTo(44.64, 1);
  });

  it('level=parent rollupea children al parent', () => {
    const { total, rows } = rollupBuckets(buckets, 'parent');
    expect(total).toBe('1120.00');
    const viv = rows.find((r) => r.id === 'vivienda')!;
    expect(viv.amount).toBe('620.00');
    expect(viv.name).toBe('Vivienda');
    expect(viv.color).toBe('#6366f1');
    const alim = rows.find((r) => r.id === 'alimentacion')!;
    expect(alim.amount).toBe('300.00');
    const vac = rows.find((r) => r.id === 'vacaciones')!;
    expect(vac.amount).toBe('200.00');
    expect(vac.isLeaf).toBe(true); // parent sin children → es leaf también
    // Total filas = 3 (Vivienda + Alimentación + Vacaciones)
    expect(rows).toHaveLength(3);
  });

  it('porcentajes suman ~100', () => {
    const { rows } = rollupBuckets(buckets, 'parent');
    const totalPct = rows.reduce((acc, r) => acc + r.pct, 0);
    expect(totalPct).toBeCloseTo(100, 1);
  });

  it('buckets vacíos → total 0 y rows []', () => {
    const { total, rows } = rollupBuckets([], 'parent');
    expect(total).toBe('0.00');
    expect(rows).toEqual([]);
  });

  it('bucket con amount 0 se omite del output', () => {
    const b0 = buckets[0]!;
    const b1 = buckets[1]!;
    const out = rollupBuckets([{ ...b0, amount: '0' }, { ...b1 }], 'parent');
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]?.id).toBe('vivienda');
    expect(out.rows[0]?.amount).toBe('120.00');
  });

  it('ordena por amount desc', () => {
    const { rows } = rollupBuckets(buckets, 'parent');
    for (let i = 1; i < rows.length; i++) {
      const prev = Number.parseFloat(rows[i - 1]!.amount);
      const cur = Number.parseFloat(rows[i]!.amount);
      expect(prev).toBeGreaterThanOrEqual(cur);
    }
  });
});
