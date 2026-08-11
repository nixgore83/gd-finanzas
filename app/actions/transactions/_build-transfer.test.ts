import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  computeLegAmounts,
  transferDirection,
  resignAmount,
  extractOperationRef,
  selectOperationRefTransferMatch,
  selectSameCurrencyTransferMatch,
} from './_build-transfer';

describe('computeLegAmounts', () => {
  const rate = new Decimal('1000');

  it('pata USD: amount_usd es el monto tal cual, ars se multiplica', () => {
    expect(computeLegAmounts(new Decimal('20'), 'USD', rate, 1)).toEqual({
      amountOriginal: '20.00',
      amountUsd: '20.00',
      amountArs: '20000.00',
    });
  });

  it('pata ARS: amount_ars es el monto tal cual, usd se divide', () => {
    expect(computeLegAmounts(new Decimal('50000'), 'ARS', rate, 1)).toEqual({
      amountOriginal: '50000.00',
      amountUsd: '50.00',
      amountArs: '50000.00',
    });
  });

  it('sign -1 (sale de la cuenta) niega las tres columnas', () => {
    expect(computeLegAmounts(new Decimal('20'), 'USD', rate, -1)).toEqual({
      amountOriginal: '-20.00',
      amountUsd: '-20.00',
      amountArs: '-20000.00',
    });
  });

  it('toma la magnitud: un monto ya negativo no invierte el signo pedido', () => {
    expect(computeLegAmounts(new Decimal('-20'), 'USD', rate, 1).amountOriginal).toBe('20.00');
  });

  it('REGRESIÓN: un pago en USD sobre una TC "ARS" NO se denomina en ARS', () => {
    // El bug: la pata usaba la currency_default de la cuenta (ARS) y guardaba
    // USD 1,01 como ARS 1,01 → amount_usd 0,00. La moneda es la del movimiento.
    const leg = computeLegAmounts(new Decimal('1.01'), 'USD', rate, -1);
    expect(leg.amountUsd).toBe('-1.01');
    expect(leg.amountArs).toBe('-1010.00');
  });
});

describe('transferDirection', () => {
  it('income siempre entra, expense siempre sale', () => {
    expect(transferDirection('income', '100.00')).toBe('in');
    expect(transferDirection('expense', '100.00')).toBe('out');
  });

  it('transfer se decide por el signo del monto', () => {
    expect(transferDirection('transfer', '-100.00')).toBe('out');
    expect(transferDirection('transfer', '100.00')).toBe('in');
    expect(transferDirection('transfer', '0.00')).toBe('in');
  });
});

describe('resignAmount', () => {
  it('out → magnitud negativa, in → magnitud positiva, sin importar el signo de entrada', () => {
    expect(resignAmount('100.00', 'out')).toBe('-100.00');
    expect(resignAmount('-100.00', 'out')).toBe('-100.00');
    expect(resignAmount('100.00', 'in')).toBe('100.00');
    expect(resignAmount('-100.00', 'in')).toBe('100.00');
  });
});

describe('selectSameCurrencyTransferMatch', () => {
  it('parea 1 candidato de dirección opuesta dentro de tolerancia (línea saliente)', () => {
    // Línea sale → la contraparte recibe (monto positivo).
    const id = selectSameCurrencyTransferMatch(
      [{ id: 'a', amountOriginal: '1000.00' }],
      '1000.00',
      true,
    );
    expect(id).toBe('a');
  });

  it('parea para línea entrante (contraparte manda → monto negativo)', () => {
    const id = selectSameCurrencyTransferMatch(
      [{ id: 'b', amountOriginal: '-1000.00' }],
      '1000.00',
      false,
    );
    expect(id).toBe('b');
  });

  it('ignora candidatos del mismo sentido', () => {
    // Línea saliente busca positivos; un candidato negativo no aplica.
    expect(
      selectSameCurrencyTransferMatch([{ id: 'a', amountOriginal: '-1000.00' }], '1000.00', true),
    ).toBeNull();
  });

  it('respeta la tolerancia de ±10%', () => {
    // diff 5% → entra
    expect(
      selectSameCurrencyTransferMatch([{ id: 'a', amountOriginal: '1050.00' }], '1000.00', true),
    ).toBe('a');
    // diff 20% → fuera
    expect(
      selectSameCurrencyTransferMatch([{ id: 'a', amountOriginal: '1200.00' }], '1000.00', true),
    ).toBeNull();
  });

  it('si hay 2+ candidatos válidos, es ambiguo → null', () => {
    expect(
      selectSameCurrencyTransferMatch(
        [
          { id: 'a', amountOriginal: '1000.00' },
          { id: 'b', amountOriginal: '1005.00' },
        ],
        '1000.00',
        true,
      ),
    ).toBeNull();
  });

  it('sin candidatos → null', () => {
    expect(selectSameCurrencyTransferMatch([], '1000.00', true)).toBeNull();
  });
});

describe('extractOperationRef', () => {
  it('extrae la referencia de las dos patas de un traspaso ICBC', () => {
    expect(extractOperationRef('TR.7772754  A 0905/11102104/13')).toBe('7772754');
    expect(extractOperationRef('TR.7772754 DE 0926/01109094/30')).toBe('7772754');
  });

  it('tolera espacio después del punto', () => {
    expect(extractOperationRef('TR. 7620783 A 0926/0110909')).toBe('7620783');
  });

  it('null si el concepto no trae referencia', () => {
    expect(extractOperationRef('TRANSF. E/BCOS-ONLINE')).toBeNull();
    expect(extractOperationRef('PAGO TARJETA VISA')).toBeNull();
    // Menos de 6 dígitos: no es un nro de operación.
    expect(extractOperationRef('TR.1234 A 0905')).toBeNull();
  });
});

describe('selectOperationRefTransferMatch', () => {
  // Caso real: compra de USD en ICBC. Sale ARS de la caja de ahorro en pesos y
  // entran USD a la de dólares; montos distintos, misma referencia.
  const usdLeg = {
    id: 'usd',
    description: 'TR.7772754 DE 0926/01109094/30',
    amountOriginal: '30.00',
  };

  it('parea cross-currency con montos distintos (línea saliente)', () => {
    expect(selectOperationRefTransferMatch([usdLeg], '7772754', true)).toBe('usd');
  });

  it('parea para línea entrante (la contraparte manda → negativo)', () => {
    const arsLeg = {
      id: 'ars',
      description: 'TR.7772754  A 0905/11102104/13',
      amountOriginal: '-42600.00',
    };
    expect(selectOperationRefTransferMatch([arsLeg], '7772754', false)).toBe('ars');
  });

  it('ignora candidatos con otra referencia', () => {
    expect(selectOperationRefTransferMatch([usdLeg], '7795790', true)).toBeNull();
  });

  it('ignora candidatos del mismo sentido', () => {
    // Línea saliente busca una pata que entre; ésta también sale.
    expect(
      selectOperationRefTransferMatch(
        [{ ...usdLeg, amountOriginal: '-30.00' }],
        '7772754',
        true,
      ),
    ).toBeNull();
  });

  it('si la referencia aparece en 2+ patas del mismo sentido, es ambiguo → null', () => {
    // Pasa de verdad: una pata duplicada por dos fuentes solapadas del mismo banco.
    expect(
      selectOperationRefTransferMatch(
        [usdLeg, { ...usdLeg, id: 'dup' }],
        '7772754',
        true,
      ),
    ).toBeNull();
  });

  it('sin candidatos → null', () => {
    expect(selectOperationRefTransferMatch([], '7772754', true)).toBeNull();
  });
});
