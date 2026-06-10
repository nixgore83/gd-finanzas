import { describe, it, expect } from 'vitest';
import { counterpartyFromMeta, parsedTxLineSchema, parserOutputSchema } from './types';

describe('parsedTxLineSchema', () => {
  it('happy path', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-05-20',
      description: 'NETFLIX SUSCRIPCION',
      amountOriginal: '12.99',
      currencyOriginal: 'USD',
      kind: 'expense',
    });
    expect(out.success).toBe(true);
  });

  it('rechaza date sin formato YYYY-MM-DD', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '20/05/2026',
      description: 'X',
      amountOriginal: '10.00',
      currencyOriginal: 'ARS',
      kind: 'expense',
    });
    expect(out.success).toBe(false);
  });

  it('rechaza amount no numérico', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-05-20',
      description: 'X',
      amountOriginal: '$10,00',
      currencyOriginal: 'ARS',
      kind: 'expense',
    });
    expect(out.success).toBe(false);
  });

  it('rechaza currency fuera del enum', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-05-20',
      description: 'X',
      amountOriginal: '10.00',
      currencyOriginal: 'EUR',
      kind: 'expense',
    });
    expect(out.success).toBe(false);
  });
});

describe('parserOutputSchema', () => {
  it('array de líneas válidas', () => {
    const out = parserOutputSchema.safeParse({
      lines: [
        {
          date: '2026-05-20',
          description: 'X',
          amountOriginal: '10.00',
          currencyOriginal: 'ARS',
          kind: 'expense',
        },
      ],
    });
    expect(out.success).toBe(true);
  });
  it('array vacío válido', () => {
    expect(parserOutputSchema.safeParse({ lines: [] }).success).toBe(true);
  });
});

describe('parsedTxLineSchema preprocess (alias + coerce)', () => {
  it('mapea amount → amountOriginal', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-05-20',
      description: 'X',
      amount: '10.00',
      currency: 'ARS',
      kind: 'expense',
    });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.amountOriginal).toBe('10.00');
  });

  it('mapea monto/moneda/descripcion/fecha/tipo (español)', () => {
    const out = parsedTxLineSchema.safeParse({
      fecha: '2026-05-20',
      descripcion: 'COMERCIO XX',
      monto: '8350.50',
      moneda: 'ars',
      tipo: 'gasto',
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.amountOriginal).toBe('8350.50');
      expect(out.data.currencyOriginal).toBe('ARS');
      expect(out.data.kind).toBe('expense');
    }
  });

  it('coerce number → string', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-05-20',
      description: 'X',
      amountOriginal: 1234.56,
      currencyOriginal: 'USD',
      kind: 'expense',
    });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.amountOriginal).toBe('1234.56');
  });

  it('amount negativo → flip + kind=expense si no estaba seteado', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-05-20',
      description: 'X',
      amount: '-50.00',
      currency: 'USD',
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.amountOriginal).toBe('50.00');
      expect(out.data.kind).toBe('expense');
    }
  });

  it('separadores de miles US ("1,234.56") se limpian', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-05-20',
      description: 'X',
      amountOriginal: '1,234.56',
      currencyOriginal: 'USD',
      kind: 'expense',
    });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.amountOriginal).toBe('1234.56');
  });

  it('expande notación científica ("1.4090103E7" → "14090103.00")', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-06-01',
      description: 'TRANS PAG SUEL',
      amountOriginal: '1.4090103E7',
      currencyOriginal: 'ARS',
      kind: 'income',
    });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.amountOriginal).toBe('14090103.00');
  });

  it('expande notación científica corta ("1.8E7" → "18000000.00")', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-05-04',
      description: 'DEB SUSCR FCI',
      amountOriginal: '1.8E7',
      currencyOriginal: 'ARS',
      kind: 'expense',
    });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.amountOriginal).toBe('18000000.00');
  });

  it('kind crédito → income', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-05-20',
      description: 'DEVOLUCION',
      amountOriginal: '500.00',
      currencyOriginal: 'ARS',
      kind: 'credito',
    });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.kind).toBe('income');
  });
});

describe('parsedTxLineSchema isRefund', () => {
  const base = {
    date: '2026-04-09',
    description: 'Transf. de ARBA',
    amountOriginal: '166329.00',
    currencyOriginal: 'ARS' as const,
    kind: 'expense' as const,
  };

  it('default false', () => {
    const out = parsedTxLineSchema.safeParse(base);
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.isRefund).toBe(false);
  });

  it('acepta isRefund=true', () => {
    const out = parsedTxLineSchema.safeParse({ ...base, isRefund: true });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.isRefund).toBe(true);
  });

  it('normaliza alias esDevolucion + coerce string', () => {
    const out = parsedTxLineSchema.safeParse({ ...base, esDevolucion: 'true' });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.isRefund).toBe(true);
  });
});

describe('parsedTxLineSchema counterparty', () => {
  it('acepta counterparty completo', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-01-23',
      description: 'Transf. de',
      amountOriginal: '8117.71',
      currencyOriginal: 'ARS',
      kind: 'income',
      isTransfer: true,
      counterparty: {
        name: 'GORE NICOLAS MARIO',
        accountRef: '0926/01109094/30',
        cuil: '20-12345678-9',
        cbu: '0150999900000012345678',
        alias: 'mi.alias.bancario',
      },
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.counterparty?.name).toBe('GORE NICOLAS MARIO');
      expect(out.data.counterparty?.accountRef).toBe('0926/01109094/30');
      expect(out.data.counterparty?.cuil).toBe('20-12345678-9');
    }
  });

  it('normaliza aliases (cuit→cuil, account_number→accountRef, nombre→name) y trimea', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-01-23',
      description: 'ALQUILERES',
      amountOriginal: '300000.00',
      currencyOriginal: 'ARS',
      kind: 'income',
      counterparty: {
        nombre: '  OSNAJANSKY MARTI  ',
        account_number: '0072/00012345/01',
        cuit: '27-98765432-1',
      },
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.counterparty?.name).toBe('OSNAJANSKY MARTI');
      expect(out.data.counterparty?.accountRef).toBe('0072/00012345/01');
      expect(out.data.counterparty?.cuil).toBe('27-98765432-1');
    }
  });

  it('counterparty sin campos útiles → undefined', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-01-23',
      description: 'X',
      amountOriginal: '10.00',
      currencyOriginal: 'ARS',
      kind: 'expense',
      counterparty: { name: '', accountRef: '   ' },
    });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.counterparty).toBeUndefined();
  });

  it('línea sin counterparty sigue siendo válida', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-01-23',
      description: 'NETFLIX',
      amountOriginal: '12.99',
      currencyOriginal: 'USD',
      kind: 'expense',
    });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.counterparty).toBeUndefined();
  });

  it('acepta y trimea label', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-01-23',
      description: 'ALQUILER',
      amountOriginal: '300000.00',
      currencyOriginal: 'ARS',
      kind: 'expense',
      counterparty: { cuil: '27-98765432-1', label: '  Alquiler depto  ' },
    });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.counterparty?.label).toBe('Alquiler depto');
  });

  it('normaliza alias de label (etiqueta/apodo)', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-01-23',
      description: 'PAGO',
      amountOriginal: '50000.00',
      currencyOriginal: 'ARS',
      kind: 'expense',
      counterparty: { cuil: '20-11111111-2', etiqueta: 'Niñera' },
    });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.counterparty?.label).toBe('Niñera');
  });
});

describe('counterpartyFromMeta', () => {
  it('extrae counterparty válido de un meta', () => {
    const cp = counterpartyFromMeta({
      counterparty: { name: 'GORE NICOLAS', cuil: '20-12345678-9', label: 'Sueldo' },
      otraCosa: 1,
    });
    expect(cp).not.toBeNull();
    expect(cp?.name).toBe('GORE NICOLAS');
    expect(cp?.label).toBe('Sueldo');
  });

  it('devuelve null cuando no hay counterparty', () => {
    expect(counterpartyFromMeta({})).toBeNull();
    expect(counterpartyFromMeta(null)).toBeNull();
    expect(counterpartyFromMeta(undefined)).toBeNull();
    expect(counterpartyFromMeta('no-objeto')).toBeNull();
    expect(counterpartyFromMeta({ counterparty: {} })).toBeNull();
  });
});

describe('parserOutputSchema statementAccount', () => {
  it('acepta statementAccount con number y holder', () => {
    const out = parserOutputSchema.safeParse({
      lines: [],
      statementAccount: { number: '0926/01109094/30', holder: 'GORE NICOLAS MARIO' },
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.statementAccount?.number).toBe('0926/01109094/30');
      expect(out.data.statementAccount?.holder).toBe('GORE NICOLAS MARIO');
    }
  });

  it('normaliza aliases (account_number→number, titular→holder) y trimea', () => {
    const out = parserOutputSchema.safeParse({
      lines: [],
      statementAccount: { account_number: '  0072/00012345/01  ', titular: ' PAULA DALMASSO ' },
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.statementAccount?.number).toBe('0072/00012345/01');
      expect(out.data.statementAccount?.holder).toBe('PAULA DALMASSO');
    }
  });

  it('statementAccount sin datos útiles → undefined', () => {
    const out = parserOutputSchema.safeParse({
      lines: [],
      statementAccount: { number: '   ' },
    });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.statementAccount).toBeUndefined();
  });

  it('output sin statementAccount sigue siendo válido', () => {
    const out = parserOutputSchema.safeParse({ lines: [] });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.statementAccount).toBeUndefined();
  });
});
