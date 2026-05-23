import { describe, expect, it } from 'vitest';
import { normalizeDescription } from './category-suggest';

describe('normalizeDescription', () => {
  it('strips cuota suffix', () => {
    expect(normalizeDescription('MERPAGO*ECOMADERA C.17/18')).toBe('MERPAGO*ECOMADERA');
  });

  it('strips multiple cuota formats', () => {
    expect(normalizeDescription('UNIVERSO AVENTURA C.09/09')).toBe('UNIVERSO AVENTURA');
    expect(normalizeDescription('MERPAGO*BIDCOM C.05/09')).toBe('MERPAGO*BIDCOM');
  });

  it('strips amount in parentheses', () => {
    expect(normalizeDescription('DEV.IMP. RG 5617 30% (147398,64)')).toBe(
      'DEV.IMP. RG 5617 30%',
    );
  });

  it('strips both cuota and amount', () => {
    expect(normalizeDescription('ALGO C.03/12 (45.000,00)')).toBe('ALGO');
  });

  it('leaves clean descriptions unchanged', () => {
    expect(normalizeDescription('NETFLIX.COM')).toBe('NETFLIX.COM');
    expect(normalizeDescription('SUPERMERCADO COTO')).toBe('SUPERMERCADO COTO');
  });

  it('handles empty and whitespace', () => {
    expect(normalizeDescription('')).toBe('');
    expect(normalizeDescription('   ')).toBe('');
  });
});
