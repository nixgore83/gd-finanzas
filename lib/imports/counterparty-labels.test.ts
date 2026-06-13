import { describe, expect, it } from 'vitest';
import { mergeCounterpartyLabels } from './counterparty-labels';

describe('mergeCounterpartyLabels', () => {
  it('mergea varias fuentes y ordena alfabéticamente en español', () => {
    expect(mergeCounterpartyLabels(['Niñera', 'Alquiler'], ['Colegio'])).toEqual([
      'Alquiler',
      'Colegio',
      'Niñera',
    ]);
  });

  it('dedupea case-insensitive y gana la primera aparición', () => {
    expect(mergeCounterpartyLabels(['Niñera'], ['NIÑERA', 'niñera'])).toEqual(['Niñera']);
  });

  it('la primera fuente define el casing canónico', () => {
    // Historial primero, import actual después: el casing del historial gana.
    expect(mergeCounterpartyLabels(['alquiler'], ['Alquiler'])).toEqual(['alquiler']);
  });

  it('trimea y descarta vacíos, null y undefined', () => {
    expect(mergeCounterpartyLabels(['  Niñera  ', '', '   ', null, undefined])).toEqual([
      'Niñera',
    ]);
  });

  it('devuelve lista vacía sin fuentes o con fuentes vacías', () => {
    expect(mergeCounterpartyLabels()).toEqual([]);
    expect(mergeCounterpartyLabels([], [null, undefined])).toEqual([]);
  });
});
