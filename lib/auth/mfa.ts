export type MfaState = 'enroll' | 'challenge' | 'ok';

export type MfaCapableClient = {
  auth: {
    mfa: {
      getAuthenticatorAssuranceLevel: () => Promise<{
        data: { currentLevel: string | null; nextLevel: string | null } | null;
        error: { message: string } | null;
      }>;
    };
  };
};

export async function getMfaState(supabase: MfaCapableClient): Promise<MfaState> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) {
    throw new Error(`Failed to read MFA state: ${error?.message ?? 'no data'}`);
  }
  if (data.nextLevel !== 'aal2') return 'enroll';
  if (data.currentLevel === 'aal2') return 'ok';
  return 'challenge';
}
