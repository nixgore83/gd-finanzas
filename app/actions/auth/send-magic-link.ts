'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { emailSchema, isAllowedEmail } from '@/lib/schemas/auth';
import { getServerEnv } from '@/lib/env';

const inputSchema = z.object({ email: emailSchema });

export type SendMagicLinkResult =
  | { ok: true }
  | { ok: false; error: 'invalid_email' | 'unknown' };

/**
 * Sends a magic link if the email is in ALLOWED_EMAILS.
 *
 * Returns ok=true regardless of whether the email is allowed, so that an
 * attacker probing the form cannot tell which addresses are valid. Real
 * delivery only happens for whitelisted emails.
 */
export async function sendMagicLink(formData: FormData): Promise<SendMagicLinkResult> {
  const parsed = inputSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_email' };
  }

  const { email } = parsed.data;
  const env = getServerEnv();

  if (!isAllowedEmail(email)) {
    // Silent reject — same UX as success.
    return { ok: true };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
      shouldCreateUser: false,
    },
  });

  if (error) {
    console.error('[auth] signInWithOtp error', { code: error.code, status: error.status });
    return { ok: false, error: 'unknown' };
  }

  return { ok: true };
}
