import { describe, it, expect } from 'vitest';
import { detectTransfers, isNeverTransfer } from './detect-transfers';
import type { ParsedTxLine } from './parsers/types';

/** Línea sintética (nunca datos reales). Montos irrelevantes para esta lógica. */
function line(description: string, isTransfer = false): ParsedTxLine {
  return {
    date: '2026-05-14',
    description,
    amountOriginal: '1.00',
    currencyOriginal: 'ARS',
    kind: 'expense',
    isTransfer,
    isRefund: false,
  };
}

const flags = (lines: ParsedTxLine[]): boolean[] =>
  detectTransfers(lines).map((l) => l.isTransfer);

describe('detectTransfers — patrones que marcan transferencia', () => {
  it('marca los conceptos clásicos de traspaso entre cuentas propias', () => {
    expect(
      flags([
        line('TRANSF. CTAS PROPIAS'),
        line('TRANSFERENCIA DE CUENTA PROPIA'),
        line('DÉBITO TRANSF ENTRE CUENTAS'),
        line('TRF A CUENTA'),
      ]),
    ).toEqual([true, true, true, true]);
  });

  it('no toca un gasto común', () => {
    expect(flags([line('SUPERMERCADO COTO'), line('NETFLIX')])).toEqual([false, false]);
  });

  it('respeta lo que ya marcó el parser', () => {
    // El LLM ve la contraparte y la sección del extracto; un regex sobre la
    // descripción no. Si él dijo que es transferencia, se respeta.
    expect(flags([line('COMPRA MONEDA EXTRANJERA', true)])).toEqual([true]);
  });

  it('no muta la entrada', () => {
    const input = [line('TRANSF. CTAS PROPIAS')];
    detectTransfers(input);
    expect(input[0]?.isTransfer).toBe(false);
  });
});

describe('detectTransfers — DEBIN ya no marca por regex', () => {
  it('REGRESIÓN: un DEBIN no se marca solo como transferencia', () => {
    // `\bDEBIN\b` estaba en los patrones y marcaba como transferencia interna
    // todo Débito Inmediato. El DEBIN es un INSTRUMENTO de pago: sirve tanto
    // para que un comercio te cobre como para fondear tu cuenta de broker desde
    // tu propio banco. La descripción sola no distingue los casos, así que la
    // decisión vuelve al parser, que sí tiene contexto.
    expect(
      flags([line('DÉBITO DEBIN'), line('DEB. PREA. DEBIN'), line('DÉBITO INMEDIATO')]),
    ).toEqual([false, false, false]);
  });

  it('pero si el parser dice que ESE DEBIN es interno, se respeta', () => {
    expect(flags([line('DÉBITO DEBIN', true)])).toEqual([true]);
  });
});

describe('detectTransfers — conceptos que NUNCA son transferencia', () => {
  it('un pago con QR es una compra, aunque el parser lo haya marcado', () => {
    // La exclusión manda incluso sobre el LLM: el beneficiario viene en la
    // propia descripción, así que no hay ambigüedad posible.
    expect(flags([line('PAGO C/TF QR JAVIER EMANU', true)])).toEqual([false]);
    expect(flags([line('PAGO C/TF QR JAVIER EMANU')])).toEqual([false]);
    expect(flags([line('PAGO QR COMERCIO')])).toEqual([false]);
  });

  it('la exclusión gana sobre un patrón de transferencia en la misma línea', () => {
    expect(flags([line('TRANSF. PAGO C/TF QR KIOSCO')])).toEqual([false]);
  });

  it('isNeverTransfer es honesto sobre lo que sabe y lo que no', () => {
    expect(isNeverTransfer('PAGO C/TF QR ALGUIEN')).toBe(true);
    // DEBIN NO entra en la exclusión dura: puede ser legítimamente interno.
    expect(isNeverTransfer('DÉBITO DEBIN')).toBe(false);
    expect(isNeverTransfer('TRANSF. CTAS PROPIAS')).toBe(false);
  });
});
