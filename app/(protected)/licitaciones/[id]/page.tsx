import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { licitacionesJobs } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { isLicitacionStale } from '@/lib/licitaciones/stale';
import { JobStatus } from './job-status';

export const metadata = { title: 'Licitación · gd-finanzas' };

const STATUS_LABELS: Record<string, string> = {
  uploaded: 'Subido',
  processing: 'Procesando…',
  done: 'Listo',
  error: 'Error',
};

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export default async function LicitacionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const { id } = await params;
  const db = getDb();
  const [job] = await db
    .select({
      id: licitacionesJobs.id,
      status: licitacionesJobs.status,
      pdfCount: licitacionesJobs.pdfCount,
      modelo: licitacionesJobs.modelo,
      lunesOverride: licitacionesJobs.lunesOverride,
      errorMessage: licitacionesJobs.errorMessage,
      processingStartedAt: licitacionesJobs.processingStartedAt,
      completedAt: licitacionesJobs.completedAt,
      createdAt: licitacionesJobs.createdAt,
    })
    .from(licitacionesJobs)
    .where(and(eq(licitacionesJobs.id, id), eq(licitacionesJobs.householdId, session.householdId)))
    .limit(1);

  if (!job) notFound();

  const stale = isLicitacionStale(job.processingStartedAt, new Date());

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tanda de licitaciones</h1>
        <Link href="/licitaciones" className="text-sm text-muted-foreground hover:underline">
          ← Licitaciones
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-3 rounded-md border bg-card p-4 text-sm md:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Estado</dt>
          <dd className="font-medium">{STATUS_LABELS[job.status] ?? job.status}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">PDFs</dt>
          <dd className="font-medium">{job.pdfCount}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Lunes objetivo</dt>
          <dd className="font-medium">{job.lunesOverride ?? 'Próximo'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Modelo</dt>
          <dd className="font-mono text-xs">{job.modelo}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Creado</dt>
          <dd className="font-medium">{formatDate(job.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Completado</dt>
          <dd className="font-medium">{formatDate(job.completedAt)}</dd>
        </div>
      </dl>

      {job.errorMessage && job.status === 'error' && (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          <p className="font-medium">Error</p>
          <p>{job.errorMessage}</p>
        </div>
      )}

      <JobStatus jobId={job.id} status={job.status} stale={stale} />
    </div>
  );
}
