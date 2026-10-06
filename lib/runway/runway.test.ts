import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { addMonths, monthRange } from './months';
import { parseCuota, projectRemainingCuotas } from './cuotas';
import { averageClosedMonths } from './base-burn';
import { buildRunwayProjection } from './project';
import { spendCapStatus } from './spend-cap';
import { householdExcludedIds } from '@/lib/categories/household-exclusion';
import { isNonMonthlyExpense, recurrenceFlows, type RecurrenceForRunway } from './recurrence-flows';

const D = (v: string | number) => new Decimal(v);

describe('months', () => {
  it('suma meses cruzando el año', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthRange('2026-12', 3)).toEqual(['2026-12', '2027-01', '2027-02']);
  });
});

describe('parseCuota', () => {
  it('lee las marcas de cuota habituales', () => {
    expect(parseCuota('MERPAGO*MERCADOLIBRE C.03/06')).toEqual({ n: 3, total: 6 });
    expect(parseCuota('MERPAGO*HECTOR813 5 de 6')).toEqual({ n: 5, total: 6 });
  });

  it('un número de póliza o una línea sin marca no es cuota', () => {
    expect(parseCuota('ALLIANZ 0210/18')).toBeNull();
    expect(parseCuota('FARMACIA')).toBeNull();
    expect(parseCuota('X 7/6')).toBeNull();
  });
});

describe('projectRemainingCuotas', () => {
  it('la cuota 3/6 del resumen que cierra en septiembre se paga oct, y quedan nov–ene', () => {
    const m = projectRemainingCuotas(
      [{ description: 'X C.03/06', amountArs: '100', closeDate: '2026-09-24' }],
      '2026-10',
    );
    expect([...m.keys()]).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
    expect(m.get('2027-01')?.toString()).toBe('100');
  });

  it('no proyecta meses ya pagados y acumula varias líneas', () => {
    const m = projectRemainingCuotas(
      [
        { description: 'A C.05/06', amountArs: '50', closeDate: '2026-08-27' }, // paga sep (pasado) y oct
        { description: 'B C.01/03', amountArs: '30', closeDate: '2026-09-24' }, // oct, nov, dic
      ],
      '2026-10',
    );
    expect(m.get('2026-09')).toBeUndefined();
    expect(m.get('2026-10')?.toString()).toBe('80');
    expect(m.get('2026-12')?.toString()).toBe('30');
  });
});

describe('averageClosedMonths', () => {
  it('promedia los 3 meses cerrados anteriores y descarta los meses sin datos', () => {
    const totals = new Map([
      ['2026-07', D(15)],
      ['2026-08', D(17)],
      ['2026-10', D(99)], // mes en curso: no cuenta
    ]);
    const r = averageClosedMonths(totals, '2026-10');
    expect(r.months).toEqual(['2026-07', '2026-08']);
    expect(r.average.toString()).toBe('16');
  });
});

describe('buildRunwayProjection', () => {
  const base = {
    startMonth: '2026-10',
    months: 6,
    startBalance: D(100),
    incomes: monthRange('2026-10', 6).map((month) => ({ month, amount: D(10) })),
    baseBurn: D(16),
    burnReleases: [] as { fromMonth: string; amount: Decimal }[],
    cuotas: new Map<string, Decimal>(),
    events: [] as { month: string; amount: Decimal; label?: string }[],
  };

  it('acumula el gap mensual', () => {
    const r = buildRunwayProjection(base);
    expect(r.rows[0]?.gap.toString()).toBe('-6');
    expect(r.rows[5]?.balance.toString()).toBe('64');
    expect(r.runOutMonth).toBeNull();
  });

  it('un gasto que termina (el auto) libera su monto desde el mes siguiente', () => {
    const r = buildRunwayProjection({
      ...base,
      burnReleases: [{ fromMonth: '2027-01', amount: D(1) }],
    });
    expect(r.rows.find((x) => x.month === '2026-12')?.base.toString()).toBe('16');
    expect(r.rows.find((x) => x.month === '2027-01')?.base.toString()).toBe('15');
  });

  it('un evento anual (alquiler en marzo) y las cuotas pegan en su mes y marcan el quiebre', () => {
    const r = buildRunwayProjection({
      ...base,
      cuotas: new Map([['2026-10', D(3)]]),
      events: [{ month: '2027-03', amount: D(60), label: 'Alquiler anual' }],
    });
    const mar = r.rows.find((x) => x.month === '2027-03');
    expect(mar?.eventLabels).toEqual(['Alquiler anual']);
    expect(r.rows[0]?.cuotas.toString()).toBe('3');
    // 100 − 3 (cuotas) − 6×6 (gap) − 60 = 1 > 0 → todavía no se termina…
    expect(r.rows[5]?.balance.toString()).toBe('1');
    expect(r.runOutMonth).toBeNull();
    // …pero con un piso de 10 sí, en marzo.
    expect(
      buildRunwayProjection({
        ...base,
        events: [{ month: '2027-03', amount: D(60) }],
        floor: D(10),
      }).runOutMonth,
    ).toBe('2027-03');
  });
});

describe('spendCapStatus', () => {
  it('semáforo por porcentaje del techo', () => {
    expect(spendCapStatus({ spent: D(70), cap: D(100), today: '2026-10-30' }).level).toBe('ok');
    expect(spendCapStatus({ spent: D(85), cap: D(100), today: '2026-10-30' }).level).toBe('warn');
    expect(spendCapStatus({ spent: D(101), cap: D(100), today: '2026-10-30' }).level).toBe('over');
  });

  it('el ritmo compara contra el techo prorrateado al día', () => {
    // Día 10 de 31: lo esperado es ~32.26; gastar 50 es ir ~55% más rápido.
    const s = spendCapStatus({ spent: D(50), cap: D(100), today: '2026-10-10' });
    expect(Math.round(s.pacePct)).toBe(155);
    expect(s.level).toBe('ok');
  });

  it('sin techo no hay semáforo', () => {
    expect(spendCapStatus({ spent: D(50), cap: D(0), today: '2026-10-10' }).level).toBe('ok');
  });
});

describe('recurrenceFlows', () => {
  const opts = {
    startMonth: '2026-10',
    months: 12,
    baseWindowEnd: '2026-09-30',
    fxRate: new Decimal(1500),
  };
  const rec = (over: Partial<RecurrenceForRunway>): RecurrenceForRunway => ({
    name: 'x',
    kind: 'expense',
    amount: '100',
    currency: 'ARS',
    frequency: 'monthly',
    dayOfMonth: 1,
    startDate: '2026-01-01',
    endDate: null,
    categoryId: null,
    ...over,
  });

  it('un ingreso mensual aparece todos los meses; uno que terminó no aparece', () => {
    const f = recurrenceFlows(
      [
        rec({ kind: 'income', name: 'Pau' }),
        rec({ kind: 'income', name: 'Nico', endDate: '2026-08-31' }),
      ],
      opts,
    );
    expect(f.incomes.filter((i) => i.label === 'Pau')).toHaveLength(12);
    expect(f.incomes.filter((i) => i.label === 'Nico')).toHaveLength(0);
  });

  it('el alquiler anual en USD es un evento en marzo, convertido a ARS', () => {
    const f = recurrenceFlows(
      [
        rec({
          name: 'Alquiler anual',
          frequency: 'yearly',
          currency: 'USD',
          amount: '28000',
          startDate: '2027-03-01',
        }),
      ],
      opts,
    );
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({ month: '2027-03' });
    expect(f.events[0]?.amount.toString()).toBe('42000000');
  });

  it('un gasto mensual que ya existía no suma (está en el promedio) pero libera al terminar', () => {
    const f = recurrenceFlows(
      [rec({ name: 'Auto', amount: '1180000', endDate: '2026-12-31' })],
      opts,
    );
    expect(f.events).toHaveLength(0);
    expect(f.burnReleases).toEqual([
      { fromMonth: '2027-01', amount: new Decimal('1180000'), label: 'Auto' },
    ]);
  });

  it('un gasto mensual nuevo (posterior a la ventana del promedio) va como evento', () => {
    const f = recurrenceFlows([rec({ name: 'Nuevo', startDate: '2026-11-01' })], opts);
    expect(f.events.map((e) => e.month)).toContain('2026-11');
    expect(f.events.map((e) => e.month)).not.toContain('2026-10');
  });

  it('isNonMonthlyExpense: anual y puntual sí; mensual no', () => {
    expect(isNonMonthlyExpense(rec({ frequency: 'yearly' }))).toBe(true);
    expect(isNonMonthlyExpense(rec({ startDate: '2027-01-15', endDate: '2027-01-15' }))).toBe(true);
    expect(isNonMonthlyExpense(rec({}))).toBe(false);
    expect(isNonMonthlyExpense(rec({ kind: 'income', frequency: 'yearly' }))).toBe(false);
  });
});

describe('householdExcludedIds', () => {
  it('saca las marcadas y sus hijas, nada más', () => {
    const ids = householdExcludedIds([
      { id: 'mario', parentId: null, excludedFromHousehold: true },
      { id: 'mario-x', parentId: 'mario', excludedFromHousehold: false },
      { id: 'inv', parentId: null, excludedFromHousehold: false },
      { id: 'rh', parentId: 'inv', excludedFromHousehold: true },
      { id: 'fci', parentId: 'inv', excludedFromHousehold: false },
    ]);
    expect([...ids].sort()).toEqual(['mario', 'mario-x', 'rh']);
  });
});
