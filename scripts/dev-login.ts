import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './_env';

/**
 * Genera un magic link via admin API SIN mandar mail. Imprime la URL a stdout
 * para que el dev la copie al browser y caiga en /auth/callback con sesión
 * válida. Útil cuando el SMTP de Supabase está rate-limited (2 mails/hora en
 * free tier).
 *
 * Uso: npm run dev:login -- nixgore@gmail.com
 *
 * NOTA: solo para desarrollo. Requiere SUPABASE_SECRET_KEY (service_role) en
 * .env.local. NO ejecutar contra una DB con datos sensibles compartidos.
 */
async function main() {
  loadEnv();

  const email = process.argv[2];
  if (!email) {
    console.error('Uso: npm run dev:login -- <email>');
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  if (!url || !secret) throw new Error('NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY requeridos');

  const allowed = (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.includes(email.toLowerCase())) {
    console.error(`[dev:login] ${email} no está en ALLOWED_EMAILS — abortando`);
    process.exit(1);
  }

  const supabase = createClient(url, secret, { auth: { persistSession: false } });

  const redirectTo = `${siteUrl}/auth/callback`;
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo },
  });

  if (error || !data.properties) {
    console.error('[dev:login] generateLink failed:', error);
    process.exit(1);
  }

  console.warn('[dev:login] copiar al browser para loguearse (válido ~1h):');
  console.warn('');
  console.warn(data.properties.action_link);
  console.warn('');
  console.warn(
    '⚠️  Si en /auth/callback redirige al Site URL en vez de localhost, asegurate que NEXT_PUBLIC_SITE_URL apunte a http://localhost:3000 en .env.local.',
  );
}

main().catch((err: unknown) => {
  console.error('[dev:login] failed:', err);
  process.exit(1);
});
