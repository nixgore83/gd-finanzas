import { describe, it, expect } from 'vitest';
import { counterpartyHasIdentity } from './counterparty-suggest';

describe('counterpartyHasIdentity', () => {
  it('true con cualquier identificador fuerte', () => {
    expect(counterpartyHasIdentity({ cuil: '20-12345678-9' })).toBe(true);
    expect(counterpartyHasIdentity({ cbu: '0150999900000012345678' })).toBe(true);
    expect(counterpartyHasIdentity({ accountRef: '0926/01109094/30' })).toBe(true);
    expect(counterpartyHasIdentity({ alias: 'mi.alias' })).toBe(true);
  });

  it('true con nombre', () => {
    expect(counterpartyHasIdentity({ name: 'GORE NICOLAS' })).toBe(true);
  });

  it('false sin datos usables', () => {
    expect(counterpartyHasIdentity(null)).toBe(false);
    expect(counterpartyHasIdentity(undefined)).toBe(false);
    expect(counterpartyHasIdentity({})).toBe(false);
    expect(counterpartyHasIdentity({ name: '   ' })).toBe(false);
    // Solo label (sin identificador) no alcanza para matchear.
    expect(counterpartyHasIdentity({ label: 'Niñera' })).toBe(false);
  });
});
