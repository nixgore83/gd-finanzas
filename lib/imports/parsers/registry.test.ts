import { describe, it, expect } from 'vitest';
import { resolveParser, listParsers } from './registry';

describe('resolveParser', () => {
  it('Galicia TC → encuentra parser', () => {
    expect(resolveParser('Galicia', 'tc')).not.toBeNull();
    expect(resolveParser('galicia', 'tc')).not.toBeNull();
    expect(resolveParser('  Galicia  ', 'tc')).not.toBeNull();
  });

  it('Galicia banco → todavía no implementado', () => {
    expect(resolveParser('Galicia', 'banco')).toBeNull();
  });

  it('ICBC TC y banco encontrados', () => {
    expect(resolveParser('ICBC', 'tc')?.id).toBe('icbc-tc-v1');
    expect(resolveParser('ICBC', 'banco')?.id).toBe('icbc-banco-v1');
  });

  it('HSBC US TC y banco encontrados (match con espacio y guión)', () => {
    expect(resolveParser('HSBC US', 'tc')?.id).toBe('hsbc-us-tc-v1');
    expect(resolveParser('HSBC US', 'banco')?.id).toBe('hsbc-us-banco-v1');
    expect(resolveParser('hsbc-us', 'tc')?.id).toBe('hsbc-us-tc-v1');
  });

  it('Institución desconocida → null', () => {
    expect(resolveParser('Patagonia', 'tc')).toBeNull();
  });
});

describe('listParsers', () => {
  it('listado incluye los parsers actuales', () => {
    const ids = listParsers().map((p) => p.id);
    expect(ids).toContain('galicia-tc-v1');
    expect(ids).toContain('icbc-tc-v1');
    expect(ids).toContain('icbc-banco-v1');
    expect(ids).toContain('hsbc-us-tc-v1');
    expect(ids).toContain('hsbc-us-banco-v1');
  });
});
