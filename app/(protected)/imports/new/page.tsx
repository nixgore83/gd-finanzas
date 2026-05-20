import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { institutions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { ImportUploadForm } from './import-upload-form';

export const metadata = {
  title: 'Nuevo import · gd-finanzas',
};

export default async function NewImportPage() {
  try {
    await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const db = getDb();
  const instRows = await db
    .select({ id: institutions.id, name: institutions.name })
    .from(institutions)
    .where(eq(institutions.archived, false))
    .orderBy(asc(institutions.name));

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Nuevo import</h1>
        <p className="text-sm text-muted-foreground">
          Subí un resumen PDF (o CSV en cuentas HSBC US). Tras subirlo, vas a poder
          parsearlo con LLM y revisar las transacciones antes de confirmar.
        </p>
      </div>
      <ImportUploadForm institutions={instRows} />
    </div>
  );
}
