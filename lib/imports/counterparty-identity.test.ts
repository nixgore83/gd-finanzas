import { describe, expect, it } from 'vitest';
import {
  normalizeCounterpartyName,
  sameCounterpartyIdentity,
} from './counterparty-identity';

describe('normalizeCounterpartyName', () => {
  it('lower + trim + colapsa espacios', () => {
    expect(normalizeCounterpartyName('  GORE   NICOLAS ')).toBe('gore nicolas');
  });
});

describe('sameCounterpartyIdentity', () => {
  it('matchea por CUIL aunque el nombre difiera', () => {
    expect(
      sameCounterpartyIdentity(
        { cuil: '20-30555106-7', name: 'GORE NICOLAS' },
        { cuil: '20-30555106-7', name: 'NICOLAS GORE' },
      ),
    ).toBe(true);
  });

  it('matchea por CBU', () => {
    expect(
      sameCounterpartyIdentity(
        { cbu: '0150999900000012345678' },
        { cbu: '0150999900000012345678', name: 'Otro' },
      ),
    ).toBe(true);
  });

  it('ids fuertes distintos NO matchean aunque otro campo falte', () => {
    expect(
      sameCounterpartyIdentity({ cuil: '20-1-1' }, { cuil: '27-2-2' }),
    ).toBe(false);
  });

  it('fallback por nombre normalizado cuando no hay ids fuertes en común', () => {
    expect(
      sameCounterpartyIdentity({ name: '  ROUGIER  NAHIR ' }, { name: 'rougier nahir' }),
    ).toBe(true);
  });

  it('un id fuerte coincidente gana aunque los nombres difieran', () => {
    expect(
      sameCounterpartyIdentity(
        { alias: 'mi.alias', name: 'A' },
        { alias: 'mi.alias', name: 'B' },
      ),
    ).toBe(true);
  });

  it('null/undefined/vacíos no matchean', () => {
    expect(sameCounterpartyIdentity(null, { name: 'x' })).toBe(false);
    expect(sameCounterpartyIdentity({ name: 'x' }, undefined)).toBe(false);
    expect(sameCounterpartyIdentity({}, {})).toBe(false);
    expect(sameCounterpartyIdentity({ name: ' ' }, { name: ' ' })).toBe(false);
  });
});
