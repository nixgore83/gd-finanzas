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
