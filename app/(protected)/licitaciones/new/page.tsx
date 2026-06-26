import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { LicitacionesUploadForm } from './licitaciones-upload-form';

export const metadata = { title: 'Nueva licitación · gd-finanzas' };

// El procesamiento corre en el after() disparado desde createLicitacionJob,
// acotado a esta maxDuration (el microservicio puede tardar ~30–60s o más).
export const maxDuration = 300;

export default async function NewLicitacionPage() {
  try {
    await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Nueva tanda</h1>
        <Link href="/licitaciones" className="text-sm text-muted-foreground hover:underline">
          ← Licitaciones
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        Subí los PDFs de la semana. Claude extrae los datos y se arma el Excel del calendario.
        Al terminar vas a poder descargarlo.
      </p>
      <LicitacionesUploadForm />
    </div>
  );
}
