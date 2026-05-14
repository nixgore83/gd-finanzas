'use server';

import { createClient } from '@/lib/supabase/server';

export type EnrollResult =
  | { ok: true; factorId: string; qrCode: string; secret: string }
  | { ok: false; error: 'unauthenticated' | 'unknown' };

/**
 * Starts a TOTP enrollment.
 *
 * Cleans up any prior unverified factors so a reload of the enroll page does
 * not leave orphan entries in `auth.mfa_factors`. If the user already has a
 * verified factor, returns an error — the caller should redirect to challenge.
 */
export async function enrollMfaFactor(): Promise<EnrollResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) {
    console.error('[mfa] listFactors failed', { code: listError.code });
    return { ok: false, error: 'unknown' };
  }

  const all = factors?.all ?? [];
  const verified = all.find((f) => f.factor_type === 'totp' && f.status === 'verified');
  if (verified) return { ok: false, error: 'unknown' };

  for (const f of all.filter((f) => f.factor_type === 'totp' && f.status === 'unverified')) {
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    if (unenrollError) {
      console.error('[mfa] unenroll pending failed', { code: unenrollError.code });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Authenticator',
  });
  if (error || !data) {
    console.error('[mfa] enroll failed', { code: error?.code });
    return { ok: false, error: 'unknown' };
  }

  return {
    ok: true,
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}
