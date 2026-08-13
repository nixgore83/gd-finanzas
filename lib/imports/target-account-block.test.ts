import { describe, it, expect } from 'vitest';
import { buildTargetAccountBlock } from './target-account-block';

describe('buildTargetAccountBlock', () => {
  it('no agrega nada cuando la cuenta no tiene número cargado', () => {
    // Garantía de que el cambio es aditivo: los parsers que ya andaban no ven
    // ninguna instrucción nueva.
    expect(buildTargetAccountBlock(null)).toBe('');
    expect(buildTargetAccountBlock(undefined)).toBe('');
    expect(buildTargetAccountBlock('')).toBe('');
    expect(buildTargetAccountBlock('   ')).toBe('');
  });

  it('incluye el número de cuenta cuando está cargado', () => {
    const block = buildTargetAccountBlock('0905/02100757/27');
    expect(block).toContain('CUENTA DESTINO: 0905/02100757/27');
    expect(block).toMatch(/consolidado/i);
  });

  it('recorta espacios sobrantes del número', () => {
    expect(buildTargetAccountBlock('  1234567/3  ')).toContain('CUENTA DESTINO: 1234567/3');
  });
});
