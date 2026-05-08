import { defineConfig } from 'drizzle-kit';
import { loadEnv } from './scripts/_env';

loadEnv();

const directUrl = process.env.DIRECT_URL;
if (!directUrl) {
  throw new Error('DIRECT_URL must be set to run drizzle-kit');
}

export default defineConfig({
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: directUrl },
  strict: true,
  verbose: true,
  schemaFilter: ['public'],
});
