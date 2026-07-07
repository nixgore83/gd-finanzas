import { describe, it, expect } from 'vitest';
import { mercadoPagoBancoParser } from './mercado-pago-banco';
import { parsedTxLineSchema, type ParsedTxLine } from './types';

const parse = (rows: string[][], currency: 'ARS' | 'USD' = 'ARS') =>
  mercadoPagoBancoParser.parseXlsx!(rows, { currency });

// Filas tal como las entrega readXlsxRows (string[][]). Datos sintéticos: los TRANSACTION_TYPE son
// reales (genéricos), pero los nombres de terceros y los montos son inventados.
const HEADER = ['RELEASE_DATE', 'TRANSACTION_TYPE', 'REFERENCE_ID', 'TRANSACTION_NET_AMOUNT', 'PARTIAL_BALANCE'];
function sheet(dataRows: string[][]): string[][] {
  return [
    ['INITIAL_BALANCE', 'CREDITS', 'DEBITS', 'FINAL_BALANCE'],
    ['25.000,26', '3.306.391,65', '-3.330.541,67', '850,24'],
    [''],
    HEADER,
    ...dataRows,
  ];
}

const byDesc = (lines: ParsedTxLine[], needle: string) =>
  lines.find((l) => l.description.includes(needle))!;

describe('mercadoPagoBancoParser.parseXlsx', () => {
  it('fecha DD-MM-YYYY → YYYY-MM-DD y monto es-AR', () => {
    const { lines } = parse(sheet([['02-06-2026', 'Rendimientos', '1744608605023', '1.234,56', '25.012,40']]));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.date).toBe('2026-06-02');
    expect(lines[0]!.amountOriginal).toBe('1234.56');
    expect(lines[0]!.currencyOriginal).toBe('ARS');
  });

  it('signo define kind: negativo → expense, positivo → income', () => {
    const { lines } = parse(
      sheet([
        ['05-06-2026', 'Rendimientos', '1', '11,87', '1,00'],
        ['05-06-2026', 'Pago de servicio Edenor', '2', '-3.000,00', '1,00'],
      ]),
    );
    expect(byDesc(lines, 'Rendimientos').kind).toBe('income');
    expect(byDesc(lines, 'Edenor').kind).toBe('expense');
    expect(byDesc(lines, 'Edenor').amountOriginal).toBe('3000.00'); // siempre positivo
  });

  it('Rendimientos → income, no transfer, categoría Intereses', () => {
    const { lines } = parse(sheet([['02-06-2026', 'Rendimientos', '1', '12,14', '25.012,40']]));
    expect(lines[0]!.isTransfer).toBe(false);
    expect(lines[0]!.suggestedCategory).toBe('Intereses');
  });

  it('Transferencia a miembro del household → transfer neutra + counterparty', () => {
    const { lines } = parse(
      sheet([
        ['22-06-2026', 'Transferencia enviada Nicolas Mario Gore', '1', '-1.000,00', '5.908,96'],
        ['29-06-2026', 'Transferencia recibida PAULA CECILIA DALMASSO', '2', '5.844,86', '5.849,81'],
      ]),
    );
    const enviada = byDesc(lines, 'Nicolas Mario Gore');
    expect(enviada.isTransfer).toBe(true);
    expect(enviada.kind).toBe('expense');
    expect(enviada.counterparty?.name).toBe('Nicolas Mario Gore');

    const recibida = byDesc(lines, 'PAULA CECILIA DALMASSO');
    expect(recibida.isTransfer).toBe(true); // match household case-insensitive
    expect(recibida.kind).toBe('income');
  });

  it('Transferencia a un tercero → NO transfer (gasto/ingreso real) + counterparty', () => {
    const { lines } = parse(
      sheet([['05-06-2026', 'Transferencia enviada Juan Alberto Tercero', '1', '-5.000,00', '20.048,32']]),
    );
    expect(lines[0]!.isTransfer).toBe(false);
    expect(lines[0]!.kind).toBe('expense');
    expect(lines[0]!.counterparty?.name).toBe('Juan Alberto Tercero');
  });

  it('Ingreso de dinero → transfer entrante a revisar', () => {
    const { lines } = parse(sheet([['09-06-2026', 'Ingreso de dinero', '1', '2.360.951,00', '2.366.030,05']]));
    expect(lines[0]!.isTransfer).toBe(true);
    expect(lines[0]!.kind).toBe('income');
    expect(lines[0]!.counterparty).toBeUndefined();
  });

  it('Pago automático Tarjeta de crédito → transfer a la cuenta TC de MP', () => {
    const { lines } = parse(
      sheet([['11-06-2026', 'Pago automático Tarjeta de crédito', '1', '-2.360.950,73', '6.873,08']]),
    );
    expect(lines[0]!.isTransfer).toBe(true);
    expect(lines[0]!.transferAccountName).toBe('Mercado Pago Master');
  });

  it('Inversión → transfer saliente a revisar (sin cuenta de inversiones modelada)', () => {
    const { lines } = parse(sheet([['25-06-2026', 'Inversión Empresas Argentinas', '1', '-10.321,47', '0,00']]));
    expect(lines[0]!.isTransfer).toBe(true);
    expect(lines[0]!.kind).toBe('expense');
  });

  it('Pago de servicio ARCA → expense, categoría Impuestos', () => {
    const { lines } = parse(sheet([['09-06-2026', 'Pago de servicio ARCA', '1', '-931.269,47', '1.434.760,58']]));
    expect(lines[0]!.isTransfer).toBe(false);
    expect(lines[0]!.suggestedCategory).toBe('Impuestos');
  });

  it('saltea filas sin monto o vacías', () => {
    const { lines } = parse(
      sheet([
        ['26-06-2026', 'Rendimientos', '1', '0,00', '4,94'],
        [''],
        ['26-06-2026', 'Rendimientos', '2', '4,94', '9,88'],
      ]),
    );
    expect(lines).toHaveLength(1);
  });

  it('extrae summary de la fila CREDITS/DEBITS', () => {
    const { summary } = parse(sheet([['02-06-2026', 'Rendimientos', '1', '12,14', '25.012,40']]));
    expect(summary?.totalIncome).toBe('3306391.65');
    expect(summary?.totalExpense).toBe('3330541.67'); // |DEBITS|
    expect(summary?.currency).toBe('ARS');
  });

  it('cada línea cumple parsedTxLineSchema', () => {
    const { lines } = parse(
      sheet([
        ['02-06-2026', 'Rendimientos', '1', '12,14', '25.012,40'],
        ['22-06-2026', 'Transferencia enviada Nicolas Mario Gore', '2', '-1.000,00', '5.908,96'],
        ['09-06-2026', 'Ingreso de dinero', '3', '2.360.951,00', '2.366.030,05'],
        ['11-06-2026', 'Pago automático Tarjeta de crédito', '4', '-2.360.950,73', '6.873,08'],
      ]),
    );
    for (const line of lines) {
      expect(parsedTxLineSchema.safeParse(line).success).toBe(true);
    }
  });

  it('input que no es estado de cuenta MP → CsvFormatError', () => {
    expect(() => parse([['Fecha', 'Movimiento', 'Débito', 'Crédito'], ['01/06/2026', 'algo', '', '']])).toThrow(
      /Mercado Pago/,
    );
  });
});
