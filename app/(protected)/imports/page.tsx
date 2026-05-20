import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { imports, institutions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { IMPORT_TYPE_LABELS } from '@/lib/schemas/import';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Imports · gd-finanzas',
};

const STATUS_LABELS: Record<string, string> = {
  uploaded: 'Subido',
  parsing: 'Parseando…',
  parsed: 'Revisar',
  reviewing: 'En revisión',
  confirmed: 'Confirmado',
  error: 'Error',
};

const STATUS_TONES: Record<string, string> = {
  uploaded: 'bg-slate-100 text-slate-800 border-slate-300',
  parsing: 'bg-amber-100 text-amber-900 border-amber-300',
  parsed: 'bg-blue-100 text-blue-900 border-blue-300',
  reviewing: 'bg-blue-100 text-blue-900 border-blue-300',
  confirmed: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  error: 'bg-rose-100 text-rose-900 border-rose-300',
};

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export default async function ImportsListPage() {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const db = getDb();
  const rows = await db
    .select({
      id: imports.id,
      type: imports.type,
      status: imports.status,
      institutionId: imports.institutionId,
      institutionName: institutions.name,
      createdAt: imports.createdAt,
      transactionCount: imports.transactionCount,
    })
    .from(imports)
    .leftJoin(institutions, eq(institutions.id, imports.institutionId))
    .where(eq(imports.householdId, session.householdId))
    .orderBy(desc(imports.createdAt))
    .limit(50);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Imports</h1>
          <p className="text-sm text-muted-foreground">
            Resúmenes de banco / TC / broker procesados con AI parser + revisión humana.
          </p>
        </div>
        <Link
          href="/imports/new"
          className="inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Nuevo import
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Sin imports todavía. Subí un resumen para empezar.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Fecha</th>
                <th className="px-3 py-2 font-medium">Institución</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 text-right font-medium">Txns</th>
                <th className="px-3 py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-1.5 tabular-nums">{formatDate(r.createdAt)}</td>
                  <td className="px-3 py-1.5">{r.institutionName ?? '—'}</td>
                  <td className="px-3 py-1.5">{IMPORT_TYPE_LABELS[r.type]}</td>
                  <td className="px-3 py-1.5">
                    <span
                      className={cn(
                        'inline-block rounded-full border px-2 py-0.5 text-xs',
                        STATUS_TONES[r.status] ?? 'border-muted',
                      )}
                    >
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {r.transactionCount ?? '—'}
                  </td>
                  <td className="px-3 py-1.5">
                    <Link
                      href={`/imports/${r.id}`}
                      className="text-primary hover:underline"
                    >
                      Ver
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
