import { describe, it, expect } from 'vitest';
import {
  counterpartyHasIdentity,
  enrichLineWithHistory,
  type CounterpartyHistory,
} from './counterparty-suggest';
import type { ParsedTxLine } from './parsers/types';

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

const baseLine: ParsedTxLine = {
  date: '2026-05-10',
  description: 'TRANSF A ROUGIER',
  amountOriginal: '350000.00',
  currencyOriginal: 'ARS',
  kind: 'expense',
  isTransfer: false,
  isRefund: false,
  counterparty: { name: 'ROUGIER NAHIR', cuil: '27-41996999-6' },
};

const fullHistory: CounterpartyHistory = {
  categoryId: 'cat-1',
  label: 'Niñera',
  deducible: true,
  tagIds: ['tag-1', 'tag-2'],
  domesticService: {
    empleado_nombre: 'Rougier Nahir Esther',
    empleado_cuil: '27-41996999-6',
    concepto: 'sueldo',
  },
};

describe('enrichLineWithHistory', () => {
  it('completa label, tags, deducible y doméstico (con periodo de la fecha de la línea)', () => {
    const out = enrichLineWithHistory(baseLine, fullHistory);
    expect(out.counterparty?.label).toBe('Niñera');
    expect(out.tagIds).toEqual(['tag-1', 'tag-2']);
    expect(out.deducibleGanancias).toBe(true);
    expect(out.domesticService).toEqual({
      empleado_nombre: 'Rougier Nahir Esther',
      empleado_cuil: '27-41996999-6',
      concepto: 'sueldo',
      periodo: '2026-05',
    });
  });

  it('NO pisa lo que la línea ya tiene (no-destructivo)', () => {
    const line: ParsedTxLine = {
      ...baseLine,
      counterparty: { ...baseLine.counterparty, label: 'Otra' },
      tagIds: ['tag-x'],
      deducibleGanancias: false,
      domesticService: {
        empleado_nombre: 'Otra Persona',
        empleado_cuil: '27-11111111-1',
        concepto: 'aporte',
        periodo: '2026-04',
      },
    };
    const out = enrichLineWithHistory(line, fullHistory);
    expect(out.counterparty?.label).toBe('Otra');
    expect(out.tagIds).toEqual(['tag-x']);
    expect(out.domesticService?.empleado_nombre).toBe('Otra Persona');
    // deducible false explícito + historial true → se completa (false era el default,
    // no una decisión): el helper solo promueve true, nunca degrada.
    expect(out.deducibleGanancias).toBe(true);
  });

  it('en transferencias aplica tags y label pero NO deducible ni doméstico', () => {
    const transfer: ParsedTxLine = { ...baseLine, isTransfer: true };
    const out = enrichLineWithHistory(transfer, fullHistory);
    expect(out.tagIds).toEqual(['tag-1', 'tag-2']);
    expect(out.counterparty?.label).toBe('Niñera');
    expect(out.deducibleGanancias).toBeUndefined();
    expect(out.domesticService).toBeUndefined();
  });

  it('en ingresos no aplica deducible/doméstico', () => {
    const income: ParsedTxLine = { ...baseLine, kind: 'income' };
    const out = enrichLineWithHistory(income, fullHistory);
    expect(out.deducibleGanancias).toBeUndefined();
    expect(out.domesticService).toBeUndefined();
  });

  it('en refunds no aplica doméstico (pero sí deducible)', () => {
    const refund: ParsedTxLine = { ...baseLine, isRefund: true };
    const out = enrichLineWithHistory(refund, fullHistory);
    expect(out.domesticService).toBeUndefined();
    expect(out.deducibleGanancias).toBe(true);
  });

  it('historial vacío deja la línea intacta', () => {
    const empty: CounterpartyHistory = {
      categoryId: null,
      label: null,
      deducible: null,
      tagIds: [],
      domesticService: null,
    };
    expect(enrichLineWithHistory(baseLine, empty)).toEqual(baseLine);
  });
});
