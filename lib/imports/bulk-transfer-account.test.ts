import { describe, it, expect } from 'vitest';
import {
  bulkTransferAccountSelection,
  counterpartyAccountOptions,
  transferAccountPatch,
} from './bulk-transfer-account';

const BIND_ARS = '11111111-1111-4111-8111-111111111111';
const GALICIA_CA = '22222222-2222-4222-8222-222222222222';

describe('transferAccountPatch', () => {
  it('asignar contraparte implica isTransfer=true', () => {
    expect(transferAccountPatch({ op: 'set', transferAccountId: BIND_ARS })).toEqual({
      merge: { isTransfer: true, transferAccountId: BIND_ARS },
      remove: [],
    });
  });

  it('quitar contraparte BORRA la clave y no toca isTransfer', () => {
    const patch = transferAccountPatch({ op: 'clear' });
    expect(patch.remove).toEqual(['transferAccountId']);
    expect(patch.merge).toEqual({});
    // No se escribe `transferAccountId: null` ni `isTransfer: false`: desmarcar
    // la transferencia es otra acción (bulkSetTransfer).
    expect(Object.keys(patch.merge)).not.toContain('isTransfer');
  });

  it('el merge no arrastra claves de otra línea (es un patch, no un reemplazo)', () => {
    const patch = transferAccountPatch({ op: 'set', transferAccountId: GALICIA_CA });
    expect(Object.keys(patch.merge).sort()).toEqual(['isTransfer', 'transferAccountId']);
  });
});

describe('counterpartyAccountOptions', () => {
  const accounts = [
    { id: BIND_ARS, name: 'BIND Pau ARS' },
    { id: GALICIA_CA, name: 'Galicia CA Pau' },
  ];

  it('excluye la cuenta propia del extracto (no hay transfer a sí misma)', () => {
    expect(counterpartyAccountOptions(accounts, GALICIA_CA)).toEqual([
      { id: BIND_ARS, name: 'BIND Pau ARS' },
    ]);
  });

  it('sin cuenta propia elegida, ofrece todas', () => {
    expect(counterpartyAccountOptions(accounts, null)).toHaveLength(2);
    expect(counterpartyAccountOptions(accounts, undefined)).toHaveLength(2);
  });
});

describe('bulkTransferAccountSelection', () => {
  it('acepta una selección MIXTA income+expense: toca todas las líneas', () => {
    // Caso real: 11 líneas de la caja de ahorro Galicia de Pau contra su cuenta
    // BIND en pesos — 10 ingresos ("TRANSFERENCIA DE CUENTA PROPIA") + 1 gasto
    // ("TRANSF. CTAS PROPIAS"). La contraparte es la misma para las 11.
    const lines = [
      ...Array.from({ length: 10 }, (_, i) => ({ id: `in-${i}`, kind: 'income' as const })),
      { id: 'out-0', kind: 'expense' as const },
    ];
    const sel = bulkTransferAccountSelection(lines);
    expect(sel.ids).toHaveLength(11);
    expect(sel.ids).toContain('out-0');
    expect(sel.incomeCount).toBe(10);
    expect(sel.expenseCount).toBe(1);
    expect(sel.mixedKinds).toBe(true);
  });

  it('selección homogénea no se reporta como mixta', () => {
    const sel = bulkTransferAccountSelection([
      { id: 'a', kind: 'expense' },
      { id: 'b', kind: 'expense' },
    ]);
    expect(sel.mixedKinds).toBe(false);
    expect(sel.expenseCount).toBe(2);
    expect(sel.ids).toEqual(['a', 'b']);
  });

  it('selección vacía: sin ids ni mezcla', () => {
    expect(bulkTransferAccountSelection([])).toEqual({
      ids: [],
      incomeCount: 0,
      expenseCount: 0,
      mixedKinds: false,
    });
  });

  it('preserva el orden de la selección', () => {
    const sel = bulkTransferAccountSelection([
      { id: 'z', kind: 'income' },
      { id: 'a', kind: 'expense' },
    ]);
    expect(sel.ids).toEqual(['z', 'a']);
  });
});
