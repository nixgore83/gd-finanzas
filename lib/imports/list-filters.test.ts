import { describe, it, expect } from 'vitest';
import {
  viewToStatuses,
  isDeletableStatus,
  IMPORT_STATUSES,
} from './list-filters';

describe('viewToStatuses', () => {
  it('all → null (sin filtro)', () => {
    expect(viewToStatuses('all')).toBeNull();
  });

  it('review → todo lo no-confirmed/no-error', () => {
    expect(viewToStatuses('review')).toEqual(['uploaded', 'parsing', 'parsed', 'reviewing']);
  });

  it('confirmed → confirmed', () => {
    expect(viewToStatuses('confirmed')).toEqual(['confirmed']);
  });

  it('error → error', () => {
    expect(viewToStatuses('error')).toEqual(['error']);
  });
});

describe('isDeletableStatus', () => {
  it('borrables: uploaded, parsing, parsed, error', () => {
    expect(isDeletableStatus('uploaded')).toBe(true);
    expect(isDeletableStatus('parsing')).toBe(true);
    expect(isDeletableStatus('parsed')).toBe(true);
    expect(isDeletableStatus('error')).toBe(true);
  });

  it('NO borrables: confirmed, reviewing (pueden tener transacciones)', () => {
    expect(isDeletableStatus('confirmed')).toBe(false);
    expect(isDeletableStatus('reviewing')).toBe(false);
  });

  it('cubre todos los estados del enum sin sobrar', () => {
    // Garantía de que el enum y los helpers no se desincronizan.
    for (const s of IMPORT_STATUSES) {
      expect(typeof isDeletableStatus(s)).toBe('boolean');
    }
  });
});
