import { notFound, redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { accounts, institutions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { updateAccount } from '@/app/actions/accounts/update';
import { AccountForm } from '../account-form';

export const metadata = {
  title: 'Editar cuenta · gd-finanzas',
};

const idSchema = z.string().uuid();

type RouteParams = Promise<{ id: string }>;

export default async function EditAccountPage({ params }: { params: RouteParams }) {
  const { id: idRaw } = await params;
  if (!idSchema.safeParse(idRaw).success) notFound();
  const id = idRaw;

  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const db = getDb();
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.householdId, session.householdId)))
    .limit(1);

  if (!account) notFound();

  const list = await db
    .select({ id: institutions.id, name: institutions.name })
    .from(institutions)
    .where(eq(institutions.archived, false))
    .orderBy(asc(institutions.name));

  return (
    <div className="mx-auto max-w-xl">
      <AccountForm
        institutions={list}
        action={updateAccount}
        hiddenId={account.id}
        initial={{
          name: account.name,
          type: account.type,
          currencyDefault: account.currencyDefault,
          institutionId: account.institutionId,
          ownerTag: account.ownerTag as 'Nico' | 'Pau' | 'Hogar',
          expectsMonthlyImport: account.expectsMonthlyImport,
        }}
        submitLabel="Guardar cambios"
        title="Editar cuenta"
        description={`Editando "${account.name}". Los campos quedan inmutables solo si la app cambia, no por la base de datos.`}
      />
    </div>
  );
}
