import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMfaState } from '@/lib/auth/mfa';
import { LoginForm } from './login-form';

export const metadata = {
  title: 'Login · gd-finanzas',
};

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const state = await getMfaState(supabase);
    if (state === 'enroll') redirect('/auth/mfa/enroll');
    if (state === 'challenge') redirect('/auth/mfa/challenge');
    redirect('/dashboard');
  }

  return <LoginForm />;
}
