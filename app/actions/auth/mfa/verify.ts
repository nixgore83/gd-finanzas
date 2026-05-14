'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mfaCodeSchema } from '@/lib/schemas/auth';

const inputSchema = z.object({
  factorId: z.string().min(1),
  code: mfaCodeSchema,
});

export type VerifyMfaResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'invalid_code' | 'unknown' };

/**
 * Challenges + verifies a TOTP factor. Used both at enroll time (to complete
 * enrollment) and at challenge time (to upgrade the session to AAL2).
 * Supabase treats both flows identically: a successful verify upgrades AAL.
 */
export async function verifyMfaCode(formData: FormData): Promise<VerifyMfaResult> {
  const parsed = inputSchema.safeParse({
    factorId: formData.get('factorId'),
    code: formData.get('code'),
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const { factorId, code } = parsed.data;
  const supabase = await createClient();

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError || !challenge) {
    console.error('[mfa] challenge failed', { code: challengeError?.code });
    return { ok: false, error: 'unknown' };
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
  if (verifyError) {
    console.error('[mfa] verify failed', { code: verifyError.code });
    return { ok: false, error: 'invalid_code' };
  }

  return { ok: true };
}
