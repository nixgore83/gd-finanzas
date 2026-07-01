import { describe, it, expect } from 'vitest';
import {
  applyBulkToEntries,
  importTypeFromAccountType,
  type AccountMeta,
  type BulkApplyFlags,
} from './upload-config';

describe('importTypeFromAccountType', () => {
  it('mapea credit_card → tc', () => {
    expect(importTypeFromAccountType('credit_card')).toBe('tc');
  });
  it('mapea broker → broker', () => {
    expect(importTypeFromAccountType('broker')).toBe('broker');
  });
  it('el resto → banco', () => {
    expect(importTypeFromAccountType('bank_savings')).toBe('banco');
    expect(importTypeFromAccountType('bank_checking')).toBe('banco');
    expect(importTypeFromAccountType('cash')).toBe('banco');
    expect(importTypeFromAccountType('ewallet')).toBe('banco');
    expect(importTypeFromAccountType('other')).toBe('banco');
  });
});

type Entry = { id: string; file: string; institutionId: string; type: 'tc' | 'banco' | 'broker'; accountId: string };

const meta: AccountMeta = {
  'acc-icbc-amex': { institutionId: 'icbc', importType: 'tc' },
  'acc-icbc-ca': { institutionId: 'icbc', importType: 'banco' },
  'acc-hsbc-ca': { institutionId: 'hsbc', importType: 'banco' },
};

const ALL: BulkApplyFlags = { institution: true, type: true, account: true };

function entries(): Entry[] {
  return [
    { id: '1', file: 'a.pdf', institutionId: 'icbc', type: 'tc', accountId: '' },
    { id: '2', file: 'b.pdf', institutionId: 'hsbc', type: 'banco', accountId: 'acc-hsbc-ca' },
  ];
}

describe('applyBulkToEntries', () => {
  it('con todos los flags y una cuenta: propaga cuenta + su institución + su tipo', () => {
    const out = applyBulkToEntries(
      entries(),
      { institutionId: 'icbc', type: 'banco', accountId: 'acc-icbc-amex' },
      ALL,
      meta,
    );
    // La cuenta manda: institución=icbc, tipo=tc (aunque bulk.type era 'banco')
    expect(out.every((e) => e.accountId === 'acc-icbc-amex')).toBe(true);
    expect(out.every((e) => e.institutionId === 'icbc')).toBe(true);
    expect(out.every((e) => e.type === 'tc')).toBe(true);
  });

  it('preserva id y file de cada entrada', () => {
    const out = applyBulkToEntries(entries(), { institutionId: 'icbc', type: 'tc', accountId: '' }, ALL, meta);
    expect(out.map((e) => e.id)).toEqual(['1', '2']);
    expect(out.map((e) => e.file)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('propaga solo Institución (Tipo/Cuenta destildados), sin tocar tipo', () => {
    const out = applyBulkToEntries(
      entries(),
      { institutionId: 'icbc', type: 'broker', accountId: 'acc-icbc-amex' },
      { institution: true, type: false, account: false },
      meta,
    );
    expect(out.every((e) => e.institutionId === 'icbc')).toBe(true);
    // tipos originales intactos
    expect(out[0]!.type).toBe('tc');
    expect(out[1]!.type).toBe('banco');
  });

  it('al propagar Institución sin Cuenta, resetea la cuenta huérfana de otra institución', () => {
    const out = applyBulkToEntries(
      entries(),
      { institutionId: 'icbc', type: 'tc', accountId: '' },
      { institution: true, type: false, account: false },
      meta,
    );
    // entry 2 tenía acc-hsbc-ca (hsbc) y ahora es icbc → cuenta reseteada
    expect(out[1]!.accountId).toBe('');
    // entry 1 no tenía cuenta → sigue vacía
    expect(out[0]!.accountId).toBe('');
  });

  it('no resetea la cuenta si ya pertenece a la institución propagada', () => {
    const start: Entry[] = [
      { id: '1', file: 'a.pdf', institutionId: 'hsbc', type: 'banco', accountId: 'acc-icbc-ca' },
    ];
    const out = applyBulkToEntries(
      start,
      { institutionId: 'icbc', type: 'tc', accountId: '' },
      { institution: true, type: false, account: false },
      meta,
    );
    // acc-icbc-ca pertenece a icbc, que es la institución propagada → se conserva
    expect(out[0]!.accountId).toBe('acc-icbc-ca');
    expect(out[0]!.institutionId).toBe('icbc');
  });

  it('propagar Cuenta "Sin especificar" (vacía) limpia la cuenta sin tocar institución/tipo', () => {
    const out = applyBulkToEntries(
      entries(),
      { institutionId: 'icbc', type: 'tc', accountId: '' },
      { institution: false, type: false, account: true },
      meta,
    );
    expect(out.every((e) => e.accountId === '')).toBe(true);
    // institución/tipo originales intactos
    expect(out[0]!.institutionId).toBe('icbc');
    expect(out[1]!.institutionId).toBe('hsbc');
    expect(out[1]!.type).toBe('banco');
  });

  it('propagar solo Tipo no toca institución ni cuenta', () => {
    const out = applyBulkToEntries(
      entries(),
      { institutionId: 'icbc', type: 'broker', accountId: '' },
      { institution: false, type: true, account: false },
      meta,
    );
    expect(out.every((e) => e.type === 'broker')).toBe(true);
    expect(out[1]!.institutionId).toBe('hsbc');
    expect(out[1]!.accountId).toBe('acc-hsbc-ca');
  });

  it('lista vacía → devuelve lista vacía', () => {
    expect(applyBulkToEntries([], { institutionId: 'icbc', type: 'tc', accountId: '' }, ALL, meta)).toEqual([]);
  });
});
