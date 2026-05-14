import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMfaState } from '@/lib/auth/mfa';
import { enrollMfaFactor } from '@/app/actions/auth/mfa/enroll';
import { EnrollForm } from './enroll-form';

export const metadata = {
  title: 'Activar 2FA · gd-finanzas',
};

export default async function EnrollMfaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const state = await getMfaState(supabase);
  if (state === 'challenge') redirect('/auth/mfa/challenge');
  if (state === 'ok') redirect('/dashboard');

  const result = await enrollMfaFactor();
  if (!result.ok) {
    return (
      <div className="space-y-3 text-center">
        <h1 className="text-xl font-semibold">No pudimos iniciar la activación</h1>
        <p className="text-sm text-muted-foreground">
          Recargá la página. Si persiste, avisale a Nico.
        </p>
      </div>
    );
  }

  return <EnrollForm factorId={result.factorId} qrCode={result.qrCode} secret={result.secret} />;
}
