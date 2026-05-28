import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';
import { getServerEnv } from '@/lib/env';

type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

declare global {
  var db: DrizzleDB | undefined;
}

export function getDb(): DrizzleDB {
  if (globalThis.db) return globalThis.db;
  const env = getServerEnv();
  const queryClient = postgres(env.DATABASE_URL, { prepare: false, max: 2 });
  globalThis.db = drizzle(queryClient, { schema });
  return globalThis.db;
}

export type DB = DrizzleDB;
