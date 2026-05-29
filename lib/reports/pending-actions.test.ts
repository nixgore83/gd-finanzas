import { describe, it, expect } from 'vitest';
import { classifyOverdue } from './pending-actions';

describe('classifyOverdue', () => {
  const today = '2026-05-29';

  it('marca missed sin importar la fecha', () => {
    expect(classifyOverdue('missed', '2026-01-01', today)).toBe('missed');
    expect(classifyOverdue('missed', '2099-01-01', today)).toBe('missed');
  });

  it('marca grace cuando pending con fecha ya pasada', () => {
    expect(classifyOverdue('pending', '2026-05-28', today)).toBe('grace');
    expect(classifyOverdue('pending', '2026-04-01', today)).toBe('grace');
  });

  it('no marca pending con fecha futura', () => {
    expect(classifyOverdue('pending', '2026-05-30', today)).toBeNull();
    expect(classifyOverdue('pending', '2026-12-01', today)).toBeNull();
  });

  it('borde: pending con fecha == hoy no está vencida', () => {
    expect(classifyOverdue('pending', today, today)).toBeNull();
  });

  it('matched y cancelled nunca están vencidas', () => {
    expect(classifyOverdue('matched', '2026-01-01', today)).toBeNull();
    expect(classifyOverdue('cancelled', '2026-01-01', today)).toBeNull();
  });
});
