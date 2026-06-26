import { z } from 'zod';

/**
 * Validación de env resiliente y por dominio.
 *
 * `getServerEnv()` valida SOLO el núcleo que casi toda request necesita (DB +
 * Supabase + auth). Las vars de cada feature (cron, fx/BCRA, parser de imports,
 * Google Drive/Gmail, microservicio de licitaciones) se validan **lazy** con su
 * propio getter, en el punto de uso. Así una env var de un feature mal seteada o
 * faltante rompe SOLO ese feature, nunca el login ni el resto de la app
 * (antes era todo-o-nada: un faltante volteaba `getServerEnv` y con él toda
 * Server Action).
 */

const coreServerEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  ALLOWED_EMAILS: z.string().min(1),
});

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
});

export type ServerEnv = z.infer<typeof coreServerEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

function throwInvalid(scope: string, error: z.ZodError): never {
  const issues = error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid ${scope} environment variables:\n${issues}`);
}

let cachedServerEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;
  const parsed = coreServerEnvSchema.safeParse(process.env);
  if (!parsed.success) throwInvalid('core server', parsed.error);
  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

export function getClientEnv(): ClientEnv {
  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  } satisfies Record<keyof ClientEnv, string | undefined>);
  if (!parsed.success) throwInvalid('client', parsed.error);
  return parsed.data;
}

// ─── Getters por feature (lazy; validan solo lo suyo) ────────────────────────

const cronEnvSchema = z.object({ CRON_SECRET: z.string().min(16) });

/** Secreto compartido con Vercel Cron. Solo lo necesitan las rutas de cron. */
export function getCronSecret(): string {
  const parsed = cronEnvSchema.safeParse(process.env);
  if (!parsed.success) throwInvalid('cron', parsed.error);
  return parsed.data.CRON_SECRET;
}

const fxEnvSchema = z.object({
  BCRA_FX_MINORISTA_VARIABLE_ID: z.coerce.number().int().positive(),
});

/** idVariable de la serie BCRA. Solo lo necesita el feed de FX. */
export function getBcraVariableId(): number {
  const parsed = fxEnvSchema.safeParse(process.env);
  if (!parsed.success) throwInvalid('fx (BCRA)', parsed.error);
  return parsed.data.BCRA_FX_MINORISTA_VARIABLE_ID;
}

const importParserEnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  IMPORT_PARSER_MODEL_DEFAULT: z.string().min(1).default('claude-sonnet-4-6'),
  IMPORT_PARSER_MODEL_CHEAP: z.string().min(1).default('claude-haiku-4-5-20251001'),
});
export type ImportParserEnv = z.infer<typeof importParserEnvSchema>;

/** Anthropic + modelos. Solo lo necesita el parser de imports. */
export function getImportParserEnv(): ImportParserEnv {
  const parsed = importParserEnvSchema.safeParse(process.env);
  if (!parsed.success) throwInvalid('import parser (Anthropic)', parsed.error);
  return parsed.data;
}

const googleEnvSchema = z.object({
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_DRIVE_BACKUP_FOLDER_ID: z.string().optional(),
});
export type GoogleEnv = z.infer<typeof googleEnvSchema>;

/** OAuth de Google (Drive backups / Gmail import). Todas opcionales; el
 *  consumidor chequea presencia. Nunca tira (no rompe el resto). */
export function getGoogleEnv(): GoogleEnv {
  const parsed = googleEnvSchema.safeParse(process.env);
  return parsed.success ? parsed.data : {};
}

const licitacionesServiceEnvSchema = z.object({
  LICITACIONES_SERVICE_URL: z.string().url().optional(),
  LICITACIONES_SERVICE_SECRET: z.string().min(16).optional(),
});
export type LicitacionesServiceEnv = z.infer<typeof licitacionesServiceEnvSchema>;

/** Microservicio de licitaciones. Opcionales; el cliente maneja 'not_configured'.
 *  Si una está mal formada, no tira: devuelve vacío → el feature reporta no
 *  configurado (nunca voltea el resto de la app). */
export function getLicitacionesServiceEnv(): LicitacionesServiceEnv {
  const parsed = licitacionesServiceEnvSchema.safeParse(process.env);
  return parsed.success ? parsed.data : {};
}
