import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMfaState } from '@/lib/auth/mfa';
import { ChallengeForm } from './challenge-form';

export const metadata = {
  title: 'Verificar 2FA · gd-finanzas',
};

export default async function ChallengeMfaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const state = await getMfaState(supabase);
  if (state === 'enroll') redirect('/auth/mfa/enroll');
  if (state === 'ok') redirect('/dashboard');

  const { data: factors, error } = await supabase.auth.mfa.listFactors();
  if (error) {
    console.error('[mfa] listFactors failed at challenge', { code: error.code });
    redirect('/login');
  }
  const verified = factors?.totp[0];
  if (!verified) redirect('/auth/mfa/enroll');

  return <ChallengeForm factorId={verified.id} />;
}
