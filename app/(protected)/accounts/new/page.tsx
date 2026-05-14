import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { institutions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { createAccount } from '@/app/actions/accounts/create';
import { AccountForm } from '../account-form';

export const metadata = {
  title: 'Nueva cuenta · gd-finanzas',
};

export default async function NewAccountPage() {
  try {
    await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const db = getDb();
  const list = await db
    .select({ id: institutions.id, name: institutions.name })
    .from(institutions)
    .where(eq(institutions.archived, false))
    .orderBy(asc(institutions.name));

  return (
    <div className="mx-auto max-w-xl">
      <AccountForm
        institutions={list}
        action={createAccount}
        submitLabel="Crear cuenta"
        title="Nueva cuenta"
        description="Cargá una cuenta bancaria, tarjeta, broker, efectivo o billetera virtual."
      />
    </div>
  );
}
