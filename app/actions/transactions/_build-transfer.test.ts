import { describe, it, expect } from 'vitest';
import {
  transferDirection,
  resignAmount,
  selectSameCurrencyTransferMatch,
} from './_build-transfer';

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
