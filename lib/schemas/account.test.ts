import { describe, it, expect } from 'vitest';
import { accountInputSchema, parseAccountFormData } from './account';

const valid = {
  name: 'Galicia Amex',
  type: 'credit_card' as const,
  currencyDefault: 'ARS' as const,
  institutionId: '00000000-0000-0000-0000-000000000001',
  ownerTag: 'Nico' as const,
};

describe('accountInputSchema', () => {
  it('accepts a valid account', () => {
    const result = accountInputSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('requires institution when type is not cash', () => {
    const result = accountInputSchema.safeParse({ ...valid, institutionId: null });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['institutionId']);
    }
  });

  it('allows null institution when type is cash', () => {
    const result = accountInputSchema.safeParse({
      ...valid,
      type: 'cash',
      institutionId: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown account type', () => {
    const result = accountInputSchema.safeParse({ ...valid, type: 'crypto' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown owner tag', () => {
    const result = accountInputSchema.safeParse({ ...valid, ownerTag: 'Vecino' });
    expect(result.success).toBe(false);
  });

  it('acepta name vacío (el rótulo es opcional, se trimea a "")', () => {
    const result = accountInputSchema.safeParse({ ...valid, name: '   ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('');
  });

  it('acepta card_brand en una tarjeta de crédito', () => {
    const result = accountInputSchema.safeParse({ ...valid, cardBrand: 'visa' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cardBrand).toBe('visa');
  });

  it('rechaza card_brand en una cuenta que no es tarjeta', () => {
    const result = accountInputSchema.safeParse({
      ...valid,
      type: 'bank_savings',
      cardBrand: 'visa',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'cardBrand')).toBe(true);
    }
  });

  it('rejects invalid institutionId uuid', () => {
    const result = accountInputSchema.safeParse({ ...valid, institutionId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

describe('parseAccountFormData', () => {
  it('coerces empty institutionId to null', () => {
    const fd = new FormData();
    fd.set('name', 'Cash USD');
    fd.set('type', 'cash');
    fd.set('currencyDefault', 'USD');
    fd.set('institutionId', '');
    fd.set('ownerTag', 'Nico');
    const result = parseAccountFormData(fd);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.institutionId).toBeNull();
  });

  it('keeps a valid institutionId string', () => {
    const fd = new FormData();
    fd.set('name', 'Galicia');
    fd.set('type', 'credit_card');
    fd.set('currencyDefault', 'ARS');
    fd.set('institutionId', '00000000-0000-0000-0000-000000000001');
    fd.set('ownerTag', 'Pau');
    const result = parseAccountFormData(fd);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.institutionId).toBe('00000000-0000-0000-0000-000000000001');
    }
  });

  it('fails when required field is missing', () => {
    const fd = new FormData();
    fd.set('name', 'Sin tipo');
    const result = parseAccountFormData(fd);
    expect(result.success).toBe(false);
  });
});
