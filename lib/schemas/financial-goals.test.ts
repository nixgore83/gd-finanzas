import { describe, it, expect } from 'vitest';
import { financialGoalsInputSchema } from './financial-goals';

const valid = {
  targetAhorroMensualUsd: '5700',
  edadTargetIfNico: 58,
  edadTargetIfPau: 60,
  numeroRetiroUsd: '2230000',
  numeroEducacionUsd: '150000',
  bufferUsd: '72000',
  notas: 'plan validado con Pau 2026-05-05',
};

describe('financialGoalsInputSchema', () => {
  it('happy path', () => {
    const out = financialGoalsInputSchema.parse(valid);
    expect(out.targetAhorroMensualUsd).toBe('5700.00');
    expect(out.edadTargetIfNico).toBe(58);
    expect(out.numeroRetiroUsd).toBe('2230000.00');
    expect(out.notas).toContain('Pau');
  });

  it('coerce de edades string', () => {
    const out = financialGoalsInputSchema.parse({ ...valid, edadTargetIfNico: '58' });
    expect(out.edadTargetIfNico).toBe(58);
  });

  it('rechaza edad fuera de rango', () => {
    expect(() =>
      financialGoalsInputSchema.parse({ ...valid, edadTargetIfNico: 17 }),
    ).toThrow();
    expect(() =>
      financialGoalsInputSchema.parse({ ...valid, edadTargetIfNico: 121 }),
    ).toThrow();
  });

  it('rechaza edad no entera', () => {
    expect(() =>
      financialGoalsInputSchema.parse({ ...valid, edadTargetIfNico: 58.5 }),
    ).toThrow();
  });

  it('rechaza monto negativo', () => {
    expect(() =>
      financialGoalsInputSchema.parse({ ...valid, bufferUsd: '-100' }),
    ).toThrow();
  });

  it('acepta monto = 0', () => {
    const out = financialGoalsInputSchema.parse({ ...valid, bufferUsd: '0' });
    expect(out.bufferUsd).toBe('0.00');
  });

  it('notas vacío / null / undefined → null', () => {
    expect(financialGoalsInputSchema.parse({ ...valid, notas: '' }).notas).toBeNull();
    expect(financialGoalsInputSchema.parse({ ...valid, notas: null }).notas).toBeNull();
    const { notas: _u, ...rest } = valid;
    expect(financialGoalsInputSchema.parse(rest).notas).toBeNull();
  });

  it('notas > 2000 chars → reject', () => {
    expect(() =>
      financialGoalsInputSchema.parse({ ...valid, notas: 'x'.repeat(2001) }),
    ).toThrow();
  });
});
