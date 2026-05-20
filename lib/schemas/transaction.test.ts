import { describe, it, expect } from 'vitest';
import { transactionInputSchema, parseTransactionFormData } from './transaction';

const UUID = '00000000-0000-0000-0000-000000000001';
const UUID2 = '00000000-0000-0000-0000-000000000002';

const validBase = {
  date: '2026-05-17',
  accountId: UUID,
  categoryId: UUID2,
  kind: 'expense' as const,
  amountOriginal: '100.50',
  currencyOriginal: 'ARS' as const,
  description: 'Supermercado',
  notes: null,
};

describe('transactionInputSchema', () => {
  it('parsea income con todos los campos', () => {
    const out = transactionInputSchema.parse({ ...validBase, kind: 'income' });
    expect(out.kind).toBe('income');
    expect(out.amountOriginal).toBe('100.50');
    expect(out.notes).toBeNull();
  });

  it('parsea expense con notes', () => {
    const out = transactionInputSchema.parse({ ...validBase, notes: '  hello  ' });
    expect(out.notes).toBe('hello');
  });

  it('notes vacío, undefined o null caen a null', () => {
    expect(transactionInputSchema.parse({ ...validBase, notes: '' }).notes).toBeNull();
    expect(transactionInputSchema.parse({ ...validBase, notes: '   ' }).notes).toBeNull();
    expect(transactionInputSchema.parse({ ...validBase, notes: null }).notes).toBeNull();
    const { notes: _unused, ...withoutNotes } = validBase;
    expect(transactionInputSchema.parse(withoutNotes).notes).toBeNull();
  });

  it('rechaza fecha mal formada', () => {
    expect(() => transactionInputSchema.parse({ ...validBase, date: '17/05/2026' })).toThrow();
    expect(() => transactionInputSchema.parse({ ...validBase, date: '2026-5-17' })).toThrow();
  });

  it('rechaza monto negativo y cero string vacío', () => {
    expect(() => transactionInputSchema.parse({ ...validBase, amountOriginal: '-10' })).toThrow();
    expect(() => transactionInputSchema.parse({ ...validBase, amountOriginal: '' })).toThrow();
  });

  it('acepta cero como monto', () => {
    const out = transactionInputSchema.parse({ ...validBase, amountOriginal: '0' });
    expect(out.amountOriginal).toBe('0.00');
  });

  it('rechaza kind inválido (transfer no permitido en 3.A)', () => {
    expect(() =>
      transactionInputSchema.parse({ ...validBase, kind: 'transfer' as unknown as 'income' }),
    ).toThrow();
  });

  it('rechaza descripción vacía y > 200', () => {
    expect(() => transactionInputSchema.parse({ ...validBase, description: '' })).toThrow();
    expect(() =>
      transactionInputSchema.parse({ ...validBase, description: 'x'.repeat(201) }),
    ).toThrow();
  });

  it('rechaza UUIDs inválidos', () => {
    expect(() => transactionInputSchema.parse({ ...validBase, accountId: 'not-a-uuid' })).toThrow();
    expect(() =>
      transactionInputSchema.parse({ ...validBase, categoryId: 'not-a-uuid' }),
    ).toThrow();
  });

  it('rechaza currency fuera de ARS/USD', () => {
    expect(() =>
      transactionInputSchema.parse({ ...validBase, currencyOriginal: 'EUR' as 'USD' }),
    ).toThrow();
  });

  describe('fxRateOverride', () => {
    it('ausente / null / "" / espacios → null', () => {
      expect(transactionInputSchema.parse(validBase).fxRateOverride).toBeNull();
      expect(
        transactionInputSchema.parse({ ...validBase, fxRateOverride: null }).fxRateOverride,
      ).toBeNull();
      expect(
        transactionInputSchema.parse({ ...validBase, fxRateOverride: '' }).fxRateOverride,
      ).toBeNull();
      expect(
        transactionInputSchema.parse({ ...validBase, fxRateOverride: '   ' }).fxRateOverride,
      ).toBeNull();
    });

    it('canonicaliza a 6 decimales', () => {
      expect(
        transactionInputSchema.parse({ ...validBase, fxRateOverride: '1500' }).fxRateOverride,
      ).toBe('1500.000000');
      expect(
        transactionInputSchema.parse({ ...validBase, fxRateOverride: '1500.25' }).fxRateOverride,
      ).toBe('1500.250000');
      expect(
        transactionInputSchema.parse({ ...validBase, fxRateOverride: '1500.1234567' })
          .fxRateOverride,
      ).toBe('1500.123457');
    });

    it('rechaza negativo, cero, no-numérico, Infinity', () => {
      expect(() =>
        transactionInputSchema.parse({ ...validBase, fxRateOverride: '-1' }),
      ).toThrow();
      expect(() =>
        transactionInputSchema.parse({ ...validBase, fxRateOverride: '0' }),
      ).toThrow();
      expect(() =>
        transactionInputSchema.parse({ ...validBase, fxRateOverride: 'abc' }),
      ).toThrow();
      expect(() =>
        transactionInputSchema.parse({ ...validBase, fxRateOverride: 'Infinity' }),
      ).toThrow();
    });
  });

  describe('tagIds', () => {
    const TAG_A = '00000000-0000-0000-0000-000000000010';
    const TAG_B = '00000000-0000-0000-0000-000000000020';

    it('ausente → array vacío', () => {
      expect(transactionInputSchema.parse(validBase).tagIds).toEqual([]);
    });

    it('array de uuids con dedupe', () => {
      const out = transactionInputSchema.parse({ ...validBase, tagIds: [TAG_A, TAG_B, TAG_A] });
      expect(out.tagIds).toEqual([TAG_A, TAG_B]);
    });

    it('rechaza items no-uuid', () => {
      expect(() =>
        transactionInputSchema.parse({ ...validBase, tagIds: [TAG_A, 'not-uuid'] }),
      ).toThrow();
    });
  });
});

describe('parseTransactionFormData', () => {
  it('parsea un FormData completo', () => {
    const fd = new FormData();
    fd.set('date', validBase.date);
    fd.set('accountId', validBase.accountId);
    fd.set('categoryId', validBase.categoryId);
    fd.set('kind', validBase.kind);
    fd.set('amountOriginal', validBase.amountOriginal);
    fd.set('currencyOriginal', validBase.currencyOriginal);
    fd.set('description', validBase.description);
    fd.set('notes', 'algo');

    const out = parseTransactionFormData(fd);
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.notes).toBe('algo');
  });

  it('notes ausente → null', () => {
    const fd = new FormData();
    fd.set('date', validBase.date);
    fd.set('accountId', validBase.accountId);
    fd.set('categoryId', validBase.categoryId);
    fd.set('kind', validBase.kind);
    fd.set('amountOriginal', validBase.amountOriginal);
    fd.set('currencyOriginal', validBase.currencyOriginal);
    fd.set('description', validBase.description);

    const out = parseTransactionFormData(fd);
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.notes).toBeNull();
  });
});

describe('extensions: subtype, deducible, meta', () => {
  it('defaults: standard, no deducible, meta null', () => {
    const out = transactionInputSchema.parse(validBase);
    expect(out.transactionSubtype).toBe('standard');
    expect(out.deducibleGanancias).toBe(false);
    expect(out.meta).toBeNull();
  });

  it('domestic_service requires meta válida', () => {
    const out = transactionInputSchema.safeParse({
      ...validBase,
      transactionSubtype: 'domestic_service',
      meta: null,
    });
    expect(out.success).toBe(false);
  });

  it('domestic_service con meta válida pasa', () => {
    const out = transactionInputSchema.parse({
      ...validBase,
      transactionSubtype: 'domestic_service',
      meta: {
        empleado_nombre: 'Rougier Nahir',
        empleado_cuil: '27-41996999-6',
        concepto: 'sueldo',
        periodo: '2026-05',
      },
    });
    expect(out.transactionSubtype).toBe('domestic_service');
    expect(out.meta?.empleado_cuil).toBe('27-41996999-6');
  });

  it('domestic_service rechaza CUIL mal formado', () => {
    const out = transactionInputSchema.safeParse({
      ...validBase,
      transactionSubtype: 'domestic_service',
      meta: {
        empleado_nombre: 'X',
        empleado_cuil: '27419969996',
        concepto: 'sueldo',
        periodo: '2026-05',
      },
    });
    expect(out.success).toBe(false);
  });

  it('domestic_service rechaza periodo YYYY-MM-DD', () => {
    const out = transactionInputSchema.safeParse({
      ...validBase,
      transactionSubtype: 'domestic_service',
      meta: {
        empleado_nombre: 'X',
        empleado_cuil: '27-41996999-6',
        concepto: 'sueldo',
        periodo: '2026-05-15',
      },
    });
    expect(out.success).toBe(false);
  });

  it('domestic_service solo aplica a expense (income rechazado)', () => {
    const out = transactionInputSchema.safeParse({
      ...validBase,
      kind: 'income',
      transactionSubtype: 'domestic_service',
      meta: {
        empleado_nombre: 'X',
        empleado_cuil: '27-41996999-6',
        concepto: 'sueldo',
        periodo: '2026-05',
      },
    });
    expect(out.success).toBe(false);
  });

  it('deducibleGanancias toma true cuando se setea', () => {
    const out = transactionInputSchema.parse({ ...validBase, deducibleGanancias: true });
    expect(out.deducibleGanancias).toBe(true);
  });
});

describe('parseTransactionFormData: nuevos campos', () => {
  it('checkbox on=true', () => {
    const fd = new FormData();
    fd.set('date', validBase.date);
    fd.set('accountId', validBase.accountId);
    fd.set('categoryId', validBase.categoryId);
    fd.set('kind', validBase.kind);
    fd.set('amountOriginal', validBase.amountOriginal);
    fd.set('currencyOriginal', validBase.currencyOriginal);
    fd.set('description', validBase.description);
    fd.set('deducibleGanancias', '1');
    const out = parseTransactionFormData(fd);
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.deducibleGanancias).toBe(true);
  });

  it('subtype domestic_service + meta desde FormData', () => {
    const fd = new FormData();
    fd.set('date', validBase.date);
    fd.set('accountId', validBase.accountId);
    fd.set('categoryId', validBase.categoryId);
    fd.set('kind', 'expense');
    fd.set('amountOriginal', '50000');
    fd.set('currencyOriginal', 'ARS');
    fd.set('description', 'Sueldo Rougier');
    fd.set('transactionSubtype', 'domestic_service');
    fd.set('meta_empleado_nombre', 'Rougier Nahir');
    fd.set('meta_empleado_cuil', '27-41996999-6');
    fd.set('meta_concepto', 'sueldo');
    fd.set('meta_periodo', '2026-05');
    const out = parseTransactionFormData(fd);
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.transactionSubtype).toBe('domestic_service');
      expect(out.data.meta?.empleado_nombre).toBe('Rougier Nahir');
    }
  });
});
