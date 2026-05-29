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

export function getDb(): DrizzleDB {
  if (globalThis.__gdFinanzasDb) return globalThis.__gdFinanzasDb;
  const env = getServerEnv();
  const queryClient = postgres(env.DATABASE_URL, { prepare: false, max: 2 });
  globalThis.__gdFinanzasDb = drizzle(queryClient, { schema });
  return globalThis.__gdFinanzasDb;
}

export type DB = DrizzleDB;
