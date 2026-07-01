import { describe, it, expect } from 'vitest';
import { DB_POOL_OPTIONS } from './client';

// Guard de regresión: estas invariantes evitan volver a la config que tumbó la
// navegación el 2026-07-01 (max: 2, sin timeouts). No testea la conexión real.
describe('DB_POOL_OPTIONS', () => {
  it('prepare: false (requerido por el transaction pooler de Supabase)', () => {
    expect(DB_POOL_OPTIONS.prepare).toBe(false);
  });

  it('max da headroom para concurrencia (Fluid Compute) sin reventar el pooler', () => {
    expect(DB_POOL_OPTIONS.max).toBeGreaterThanOrEqual(5);
    expect(DB_POOL_OPTIONS.max).toBeLessThanOrEqual(15);
  });

  it('tiene timeouts para fallar rápido en vez de colgarse', () => {
    expect(DB_POOL_OPTIONS.idle_timeout).toBeGreaterThan(0);
    expect(DB_POOL_OPTIONS.connect_timeout).toBeGreaterThan(0);
  });
});
