import { describe, expect, it } from 'vitest';
import {
  counterpartyBankRefs,
  matchAccountByRefs,
  normalizeBankRef,
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

describe('normalizeBankRef', () => {
  it('CUIT con y sin guiones normalizan igual', () => {
    expect(normalizeBankRef('20-30555106-7')).toBe('20305551067');
    expect(normalizeBankRef('20305551067')).toBe('20305551067');
  });

  it('alias (pocos dígitos) queda lower+trim', () => {
    expect(normalizeBankRef('  Mi.Alias.MP ')).toBe('mi.alias.mp');
  });
});

describe('counterpartyBankRefs / matchAccountByRefs', () => {
  const accounts = [
    { id: 'acc-galicia', transferRefs: ['20305551067', '0070999030004012345678'] },
    { id: 'acc-icbc', transferRefs: ['0150999900000012345678'] },
    { id: 'acc-sin-refs', transferRefs: null },
  ];

  it('resuelve la cuenta por CUIT aunque venga con guiones', () => {
    expect(matchAccountByRefs({ cuil: '20-30555106-7' }, accounts)).toBe('acc-galicia');
  });

  it('resuelve por CBU', () => {
    expect(matchAccountByRefs({ cbu: '0150999900000012345678' }, accounts)).toBe('acc-icbc');
  });

  it('sin refs en la contraparte (solo nombre) no resuelve', () => {
    expect(counterpartyBankRefs({ name: 'GORE NICOLAS' })).toEqual([]);
    expect(matchAccountByRefs({ name: 'GORE NICOLAS' }, accounts)).toBeNull();
  });

  it('ambigüedad (matchea más de una cuenta) → null, queda manual', () => {
    const dup = [
      { id: 'a', transferRefs: ['20305551067'] },
      { id: 'b', transferRefs: ['20-30555106-7'] },
    ];
    expect(matchAccountByRefs({ cuil: '20305551067' }, dup)).toBeNull();
  });

  it('sin match → null', () => {
    expect(matchAccountByRefs({ cuil: '27-99999999-9' }, accounts)).toBeNull();
  });
});
