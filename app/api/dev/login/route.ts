import { NextResponse, type NextRequest } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient as createSsrClient } from '@/lib/supabase/server';
import { getServerEnv } from '@/lib/env';

/**
 * DEV ONLY: salta el rate limit del SMTP de Supabase generando un OTP via
 * admin API y verificándolo del lado server (no del browser), seteando las
 * cookies de sesión directamente. Útil cuando los magic links del mail no
 * llegan a tiempo o se queman antes de poder usarlos.
 *
 * Uso: abrir en el browser
 *   http://localhost:3000/api/dev/login?email=nixgore@gmail.com
 *
 * MFA: si el user tiene TOTP enrolled, el layout protegido va a pedir el
 * challenge igual. Eso NO se bypassa — necesitás tu authenticator app.
 *
 * Solo responde si `NODE_ENV !== 'production'`. En Vercel prod devuelve 404.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse('not found', { status: 404 });
  }

  const env = getServerEnv();
  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'email param required' }, { status: 400 });
  }

  const allowed = env.ALLOWED_EMAILS.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.includes(email.toLowerCase())) {
    return NextResponse.json({ error: 'email not in ALLOWED_EMAILS' }, { status: 403 });
  }

  // 1) Admin genera el OTP sin mandar mail.
  const admin = createAdminClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkErr || !linkData.properties?.email_otp) {
    console.error('[dev/login] generateLink failed', { code: linkErr?.code });
    return NextResponse.json({ error: 'generateLink failed' }, { status: 500 });
  }

  // 2) SSR client verifica el OTP server-side (no browser). Esto setea las
  //    cookies de sesión en la response.
  const supabase = await createSsrClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    email,
    token: linkData.properties.email_otp,
    type: 'magiclink',
  });
  if (verifyErr) {
    console.error('[dev/login] verifyOtp failed', { code: verifyErr.code });
    return NextResponse.json({ error: 'verifyOtp failed' }, { status: 500 });
  }

  // 3) Redirigir al dashboard. El layout protegido va a forzar el MFA
  //    challenge si el user tiene TOTP enrolled.
  return NextResponse.redirect(new URL('/dashboard', url.origin));
}
