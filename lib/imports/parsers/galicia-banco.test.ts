import { describe, it, expect } from 'vitest';
import { galiciaBancoParser } from './galicia-banco';
import { CsvFormatError, parsedTxLineSchema } from './types';

const parse = (rows: string[][], currency: 'ARS' | 'USD' = 'ARS') =>
  galiciaBancoParser.parseXlsx!(rows, { currency });

// Filas SINTÉTICAS (no datos reales) que reproducen el layout del xlsx de Galicia.
const HEADER: string[][] = [
  ['Banco Galicia - Caja Ahorro Pesos'],
  ['Nro. de Cuenta: ...0000000'],
  ['Fecha Actual: 10/6/2026'],
  ['Hora Actual: 13:53'],
  ['Intervalo de Consulta: del 01/01/2026 al 11/06/2026'],
  ['Fecha', 'Movimiento', 'Débito', 'Crédito', 'Saldo Parcial', 'Comentarios'],
];
const ROWS: string[][] = [
  ...HEADER,
  ['09/06/2026', 'TRANSF. CTAS PROPIAS\nCU  20305551067\n0150926101000109094301\nBSTN\nVARIOS', '-99.235,24', '0,00', '0', ''],
  ['09/06/2026', 'RESCATE FIMA\nFIMA PREMIUM CLASE A\nNro Operacion: 218482593', '0,00', '98.475,24', '', ''],
  ['05/06/2026', 'PAGO TARJETA VISA\nOPERACION 5083308976', '-1.050.405,88', '0,00', '', ''],
  ['08/06/2026', 'REINTEGRO PROMOCION GALICIA\nGastronomía', '0,00', '3.560,00', '', ''],
  ['18/05/2026', 'IVA', '-1.530,74', '0,00', '', ''],
  ['22/05/2026', 'INTERES CAPITALIZADO', '0,00', '0,06', '', ''],
  ['15/04/2026', 'TRANSFERENCIA A TERCEROS\nGENZONE JORGE PEDRO\n20075905336\nVARIOS', '-26.000,00', '0,00', '', ''],
  ['14/04/2026', 'TRANSFERENCIA A TERCEROS\nCU 27288643110\n0340100808710150284008', '-18.000,00', '0,00', '', ''],
  ['13/04/2026', 'SALDO INFORMATIVO', '0,00', '0,00', '', ''], // ambos 0 → se saltea
];

describe('galiciaBancoParser.parseXlsx', () => {
  const byDesc = (d: string) => parse(ROWS).lines.find((l) => l.description === d)!;

  it('parsea DD/MM/YYYY→ISO, es-AR, débito→expense / crédito→income', () => {
    const t = byDesc('TRANSF. CTAS PROPIAS');
    expect(t.date).toBe('2026-06-09');
    expect(t.kind).toBe('expense');
    expect(t.amountOriginal).toBe('99235.24');
    expect(t.currencyOriginal).toBe('ARS');

    const r = byDesc('RESCATE FIMA');
    expect(r.kind).toBe('income');
    expect(r.amountOriginal).toBe('98475.24');
  });

  it('saltea filas con débito y crédito en cero', () => {
    expect(parse(ROWS).lines.some((l) => l.description === 'SALDO INFORMATIVO')).toBe(false);
  });

  it('es-AR con separador de miles ("-1.050.405,88")', () => {
    expect(byDesc('PAGO TARJETA VISA').amountOriginal).toBe('1050405.88');
  });

  it('extrae contraparte (cuil / cbu / name) del campo multilínea', () => {
    const t = byDesc('TRANSF. CTAS PROPIAS');
    expect(t.counterparty?.cuil).toBe('20305551067');
    expect(t.counterparty?.cbu).toBe('0150926101000109094301');

    const ter = byDesc('TRANSFERENCIA A TERCEROS'); // primera (GENZONE)
    expect(ter.counterparty?.name).toBe('GENZONE JORGE PEDRO');
    expect(ter.counterparty?.cuil).toBe('20075905336');
  });

  it('marca transfer: CTAS PROPIAS, FIMA(+hint), pago tarjeta(+hint)', () => {
    expect(byDesc('TRANSF. CTAS PROPIAS').isTransfer).toBe(true);
    const fima = byDesc('RESCATE FIMA');
    expect(fima.isTransfer).toBe(true);
    expect(fima.transferAccountName).toBe('Galicia Inversiones');
    const visa = byDesc('PAGO TARJETA VISA');
    expect(visa.isTransfer).toBe(true);
    expect(visa.transferAccountName).toBe('Galicia Visa');
  });

  it('marca transfer cuando la contraparte tiene CUIT del household (Pau)', () => {
    // 27288643110 contiene el DNI de Pau (28864311)
    const lines = parse(ROWS).lines.filter((l) => l.description === 'TRANSFERENCIA A TERCEROS');
    const pau = lines.find((l) => l.counterparty?.cuil === '27288643110')!;
    expect(pau.isTransfer).toBe(true);
    // GENZONE (tercero real, no household) NO es transfer
    const genzone = lines.find((l) => l.counterparty?.name === 'GENZONE JORGE PEDRO')!;
    expect(genzone.isTransfer).toBe(false);
  });

  it('sugiere categoría para conceptos sistemáticos', () => {
    expect(byDesc('REINTEGRO PROMOCION GALICIA').suggestedCategory).toBe('Otros ingresos');
    expect(byDesc('IVA').suggestedCategory).toBe('Gastos bancarios');
    expect(byDesc('INTERES CAPITALIZADO').suggestedCategory).toBe('Intereses');
  });

  it('respeta la moneda de la cuenta (USD)', () => {
    const rows = [...HEADER, ['02/01/2026', 'TRANSF. CTAS PROPIAS', '-500,00', '0,00', '', '']];
    expect(parse(rows, 'USD').lines[0]!.currencyOriginal).toBe('USD');
  });

  it('cada línea producida pasa parsedTxLineSchema', () => {
    for (const line of parse(ROWS).lines) {
      expect(parsedTxLineSchema.safeParse(line).success).toBe(true);
    }
  });

  it('lanza CsvFormatError si no es el layout de Galicia', () => {
    expect(() => parse([['fecha', 'concepto'], ['x', 'y']])).toThrow(CsvFormatError);
  });
});
