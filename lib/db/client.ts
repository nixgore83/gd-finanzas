import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';
import { getServerEnv } from '@/lib/env';

type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

// Namespaced para no colisionar con otras globals del runtime. Cacheamos el
// cliente en globalThis para sobrevivir el Fast Refresh de Next en dev y no
// fugar conexiones a Postgres.
declare global {
  var __gdFinanzasDb: DrizzleDB | undefined;
}

/**
 * Opciones del pool de `postgres-js`. `DATABASE_URL` apunta al pooler de Supabase
 * (transaction mode, pgbouncer) → `prepare: false` es obligatorio y el pooler
 * multiplexa las conexiones de cliente contra menos conexiones reales a Postgres.
 *
 * - `max`: conexiones por instancia. Con Fluid Compute UNA instancia sirve varias
 *   requests concurrentes que comparten este pool. Con `max: 2`, un parse pesado
 *   (`after()`) + navegación saturaban el pool y hasta un GET read-only se colgaba
 *   esperando una conexión hasta la `maxDuration` (300s) → "This page couldn't
 *   load" (incidente 2026-07-01). El transaction pooler aguanta muchas conexiones
 *   de cliente, así que 8 es seguro para 2 usuarios y da headroom.
 * - `idle_timeout` (s): cerrar conexiones ociosas para no retener slots del pooler.
 * - `connect_timeout` (s): fallar rápido si no se puede conectar, en vez de colgar.
 */
export const DB_POOL_OPTIONS = {
  prepare: false,
  max: 8,
  idle_timeout: 20,
  connect_timeout: 10,
} as const;

export function getDb(): DrizzleDB {
  if (globalThis.__gdFinanzasDb) return globalThis.__gdFinanzasDb;
  const env = getServerEnv();
  const queryClient = postgres(env.DATABASE_URL, DB_POOL_OPTIONS);
  globalThis.__gdFinanzasDb = drizzle(queryClient, { schema });
  return globalThis.__gdFinanzasDb;
}

export type DB = DrizzleDB;
