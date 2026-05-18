import { describe, it, expect } from 'vitest';
import { transferInputSchema, parseTransferFormData } from './transfer';

const UUID_A = '00000000-0000-0000-0000-000000000001';
const UUID_B = '00000000-0000-0000-0000-000000000002';

const valid = {
  date: '2026-05-17',
  accountFromId: UUID_A,
  accountToId: UUID_B,
  amountFrom: '50000',
  amountTo: '50000',
  description: 'Transfer ARS→ARS',
  notes: null,
};

describe('transferInputSchema', () => {
  it('parsea happy path', () => {
    const out = transferInputSchema.parse(valid);
    expect(out.accountFromId).toBe(UUID_A);
    expect(out.accountToId).toBe(UUID_B);
    expect(out.amountFrom).toBe('50000.00');
    expect(out.amountTo).toBe('50000.00');
    expect(out.fxRateOverride).toBeNull();
  });

  it('rechaza accounts iguales', () => {
    expect(() =>
      transferInputSchema.parse({ ...valid, accountToId: UUID_A }),
    ).toThrow(/distintas/);
  });

  it('rechaza montos negativos / vacíos / cero string', () => {
    expect(() => transferInputSchema.parse({ ...valid, amountFrom: '-10' })).toThrow();
    expect(() => transferInputSchema.parse({ ...valid, amountTo: '' })).toThrow();
  });

  it('acepta montos cross-currency distintos', () => {
    const out = transferInputSchema.parse({
      ...valid,
      amountFrom: '1500000',
      amountTo: '1000',
    });
    expect(out.amountFrom).toBe('1500000.00');
    expect(out.amountTo).toBe('1000.00');
  });

  it('fxRateOverride: vacío → null, válido → 6 decimales, inválido → throw', () => {
    expect(transferInputSchema.parse(valid).fxRateOverride).toBeNull();
    expect(
      transferInputSchema.parse({ ...valid, fxRateOverride: '1500' }).fxRateOverride,
    ).toBe('1500.000000');
    expect(() =>
      transferInputSchema.parse({ ...valid, fxRateOverride: '-1' }),
    ).toThrow();
    expect(() =>
      transferInputSchema.parse({ ...valid, fxRateOverride: 'abc' }),
    ).toThrow();
  });

  it('rechaza descripción vacía y > 200', () => {
    expect(() => transferInputSchema.parse({ ...valid, description: '' })).toThrow();
    expect(() =>
      transferInputSchema.parse({ ...valid, description: 'x'.repeat(201) }),
    ).toThrow();
  });

  it('rechaza UUIDs inválidos', () => {
    expect(() =>
      transferInputSchema.parse({ ...valid, accountFromId: 'not-uuid' }),
    ).toThrow();
    expect(() =>
      transferInputSchema.parse({ ...valid, accountToId: 'not-uuid' }),
    ).toThrow();
  });

  describe('tagIds', () => {
    const TAG_A = '00000000-0000-0000-0000-000000000010';

    it('ausente → array vacío', () => {
      expect(transferInputSchema.parse(valid).tagIds).toEqual([]);
    });

    it('array dedupea', () => {
      const out = transferInputSchema.parse({ ...valid, tagIds: [TAG_A, TAG_A] });
      expect(out.tagIds).toEqual([TAG_A]);
    });
  });
});

describe('parseTransferFormData', () => {
  it('parsea FormData válida', () => {
    const fd = new FormData();
    fd.set('date', valid.date);
    fd.set('accountFromId', valid.accountFromId);
    fd.set('accountToId', valid.accountToId);
    fd.set('amountFrom', valid.amountFrom);
    fd.set('amountTo', valid.amountTo);
    fd.set('description', valid.description);

    const out = parseTransferFormData(fd);
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.notes).toBeNull();
      expect(out.data.fxRateOverride).toBeNull();
    }
  });

  it('rechaza accounts iguales con field path correcto', () => {
    const fd = new FormData();
    fd.set('date', valid.date);
    fd.set('accountFromId', UUID_A);
    fd.set('accountToId', UUID_A);
    fd.set('amountFrom', '100');
    fd.set('amountTo', '100');
    fd.set('description', 'x');

    const out = parseTransferFormData(fd);
    expect(out.success).toBe(false);
    if (!out.success) {
      const issue = out.error.issues.find((i) => i.path[0] === 'accountToId');
      expect(issue).toBeTruthy();
    }
  });
});
