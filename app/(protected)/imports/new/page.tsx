import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, institutions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { ImportUploadForm } from './import-upload-form';

export const metadata = {
  title: 'Nuevo import · gd-finanzas',
};

// La acción `createImport` corre en el contexto de esta ruta: sube a Storage y
// AHORA además auto-dispara el parseo (status='parsing' + after(parseImportInternal)).
// El trabajo pesado corre en el after() acotado a esta maxDuration, así que necesita
// los 300s (igual que /imports/[id]); el default bajo de Hobby lo mataría a mitad.
export const maxDuration = 300;

export default async function NewImportPage() {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const db = getDb();
  const [instRows, accountRows] = await Promise.all([
    db
      .select({ id: institutions.id, name: institutions.name })
      .from(institutions)
      .where(eq(institutions.archived, false))
      .orderBy(asc(institutions.name)),
    db
      .select({
        id: accounts.id,
        name: accounts.name,
        ownerTag: accounts.ownerTag,
        institutionId: accounts.institutionId,
        type: accounts.type,
      })
      .from(accounts)
      .where(and(eq(accounts.householdId, session.householdId), eq(accounts.archived, false)))
      .orderBy(asc(accounts.name)),
  ]);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Nuevo import</h1>
        <p className="text-sm text-muted-foreground">
          Subí un resumen PDF (o CSV en cuentas HSBC US). Tras subirlo, vas a poder
          parsearlo con LLM y revisar las transacciones antes de confirmar.
        </p>
      </div>
      <ImportUploadForm institutions={instRows} accounts={accountRows} />
    </div>
  );
}
