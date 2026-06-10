import { describe, it, expect } from 'vitest';
import { icbcBancoParser } from './icbc-banco';
import { CsvFormatError, parsedTxLineSchema } from './types';

const parse = (text: string, currency: 'ARS' | 'USD' = 'ARS') =>
  icbcBancoParser.parseCsv!(text, { currency });

// Filas SINTÉTICAS (no datos reales) que reproducen el layout de ICBC homebanking:
// MM/DD/YY,CONCEPTO,DEBITO,CREDITO,
const CSV = [
  '06/09/26,TRANSF. ACC.B.,27000.0,0.0,',
  '06/09/26,TRANSF. E/BCOS-ONLINE,0.0,99235.24,',
  '06/01/26,TRANS PAG SUEL,0.0,1.4090103E7,',
  '05/04/26,DEB SUSCR FCI,1.8E7,0.0,',
  '06/09/26,PAGO TARJETA VISA,835743.22,0.0,',
  '06/09/26,PAGO TARJETA MASTERCARD,1000000.0,0.0,',
  '06/08/26,COMISION CUSTODIA MENSUAL,217.11,0.0,',
  '06/08/26,SALDO INFORMATIVO,0.0,0.0,', // ambos 0 → se saltea
].join('\n');

describe('icbcBancoParser.parseCsv', () => {
  it('parsea fecha MM/DD/YY → ISO, débito→expense y crédito→income', () => {
    const { lines } = parse(CSV);
    const acc = lines.find((l) => l.description === 'TRANSF. ACC.B.')!;
    expect(acc.date).toBe('2026-06-09');
    expect(acc.kind).toBe('expense');
    expect(acc.amountOriginal).toBe('27000.00');
    expect(acc.currencyOriginal).toBe('ARS');

    const cred = lines.find((l) => l.description === 'TRANSF. E/BCOS-ONLINE')!;
    expect(cred.kind).toBe('income');
    expect(cred.amountOriginal).toBe('99235.24');
  });

  it('saltea filas con débito y crédito en cero', () => {
    const { lines } = parse(CSV);
    expect(lines.some((l) => l.description === 'SALDO INFORMATIVO')).toBe(false);
    expect(lines).toHaveLength(7);
  });

  it('expande notación científica en montos', () => {
    const { lines } = parse(CSV);
    expect(lines.find((l) => l.description === 'TRANS PAG SUEL')!.amountOriginal).toBe('14090103.00');
    expect(lines.find((l) => l.description === 'DEB SUSCR FCI')!.amountOriginal).toBe('18000000.00');
  });

  it('marca FCI como transferencia hacia ICBC Inversiones', () => {
    const fci = parse(CSV).lines.find((l) => l.description === 'DEB SUSCR FCI')!;
    expect(fci.isTransfer).toBe(true);
    expect(fci.transferAccountName).toBe('ICBC Inversiones');
  });

  it('marca pago de tarjeta como transferencia hacia la tarjeta correspondiente', () => {
    const { lines } = parse(CSV);
    expect(lines.find((l) => l.description === 'PAGO TARJETA VISA')!.transferAccountName).toBe('ICBC Visa');
    expect(lines.find((l) => l.description === 'PAGO TARJETA MASTERCARD')!.transferAccountName).toBe('ICBC Master');
  });

  it('sugiere categoría para conceptos sistemáticos', () => {
    const { lines } = parse(CSV);
    expect(lines.find((l) => l.description === 'COMISION CUSTODIA MENSUAL')!.suggestedCategory).toBe('Gastos bancarios');
    expect(lines.find((l) => l.description === 'TRANS PAG SUEL')!.suggestedCategory).toBe('Sueldo');
  });

  it('respeta la moneda de la cuenta (USD)', () => {
    const { lines } = parse('01/02/26,TRANSF. MOBILE,500.0,0.0,', 'USD');
    expect(lines[0]!.currencyOriginal).toBe('USD');
  });

  it('cada línea producida pasa parsedTxLineSchema', () => {
    for (const line of parse(CSV).lines) {
      expect(parsedTxLineSchema.safeParse(line).success).toBe(true);
    }
  });

  it('lanza CsvFormatError si el texto no es el layout ICBC (ej. CSV con header)', () => {
    expect(() => parse('fecha,concepto,debito,credito\n2026-01-02,algo,10,0')).toThrow(CsvFormatError);
  });
});
