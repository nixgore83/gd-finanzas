import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { licitacionesJobs } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { Button } from '@/components/ui/button';
import { LicitacionesTable, type LicitacionRow } from './licitaciones-table';

export const metadata = { title: 'Licitaciones · gd-finanzas' };

const PAGE_LIMIT = 50;

export default async function LicitacionesListPage() {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const db = getDb();
  const jobs = await db
    .select({
      id: licitacionesJobs.id,
      status: licitacionesJobs.status,
      pdfCount: licitacionesJobs.pdfCount,
      lunesOverride: licitacionesJobs.lunesOverride,
      outputFilePath: licitacionesJobs.outputFilePath,
      createdAt: licitacionesJobs.createdAt,
    })
    .from(licitacionesJobs)
    .where(eq(licitacionesJobs.householdId, session.householdId))
    .orderBy(desc(licitacionesJobs.createdAt))
    .limit(PAGE_LIMIT);

  const rows: LicitacionRow[] = jobs.map((j) => ({
    id: j.id,
    status: j.status,
    pdfCount: j.pdfCount,
    lunesOverride: j.lunesOverride,
    createdAt: j.createdAt.toISOString(),
    hasOutput: !!j.outputFilePath,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Calendario de Licitaciones</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Subí los PDFs de la semana y descargá el Excel del calendario.
          </p>
        </div>
        <Button asChild>
          <Link href="/licitaciones/new">+ Nueva tanda</Link>
        </Button>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">
            Sin tandas todavía. Subí los PDFs de la semana para empezar.
          </p>
          <Button asChild className="mt-4">
            <Link href="/licitaciones/new">+ Subir la primera</Link>
          </Button>
        </div>
      ) : (
        <LicitacionesTable rows={rows} />
      )}
    </div>
  );
}
