import { describe, it, expect } from 'vitest';
import {
  summarizeLineStatuses,
  importConfirmError,
  type LineSummary,
} from './line-summary';

describe('summarizeLineStatuses', () => {
  it('cuenta cada estado', () => {
    const s = summarizeLineStatuses([
      'pending',
      'pending',
      'accepted',
      'edited',
      'edited',
      'edited',
      'rejected',
    ]);
    expect(s).toEqual({ pending: 2, accepted: 1, edited: 3, rejected: 1 });
  });

  it('lista vacía → todo en cero', () => {
    expect(summarizeLineStatuses([])).toEqual({
      pending: 0,
      accepted: 0,
      rejected: 0,
      edited: 0,
    });
  });
});

describe('importConfirmError', () => {
  const s = (partial: Partial<LineSummary>): LineSummary => ({
    pending: 0,
    accepted: 0,
    rejected: 0,
    edited: 0,
    ...partial,
  });

  it('bloquea si hay líneas pending (aunque haya aceptadas)', () => {
    expect(importConfirmError(s({ pending: 1, accepted: 5 }))).toBe('unresolved_lines');
  });

  it('pending tiene prioridad sobre no_accepted', () => {
    expect(importConfirmError(s({ pending: 1 }))).toBe('unresolved_lines');
  });

  it('sin pending pero sin aceptadas/editadas → no_accepted', () => {
    expect(importConfirmError(s({ rejected: 3 }))).toBe('no_accepted');
  });

  it('sin pending y con aceptadas → confirmable (null)', () => {
    expect(importConfirmError(s({ accepted: 2 }))).toBeNull();
  });

  it('sin pending y con editadas → confirmable (null)', () => {
    expect(importConfirmError(s({ edited: 1 }))).toBeNull();
  });

  it('rejected no cuenta como confirmable por sí solo', () => {
    expect(importConfirmError(s({ accepted: 0, edited: 0, rejected: 10 }))).toBe(
      'no_accepted',
    );
  });
});
