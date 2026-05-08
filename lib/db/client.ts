import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';
import { getServerEnv } from '@/lib/env';

type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

let cached: DrizzleDB | null = null;

export function getDb(): DrizzleDB {
  if (cached) return cached;
  const env = getServerEnv();
  const queryClient = postgres(env.DATABASE_URL, { prepare: false, max: 10 });
  cached = drizzle(queryClient, { schema });
  return cached;
}

export type DB = DrizzleDB;
