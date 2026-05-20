import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, imports, importLines, institutions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { IMPORT_TYPE_LABELS } from '@/lib/schemas/import';
import { loadCategoryTree } from '@/lib/categories/tree';
import { resolveParser } from '@/lib/imports/parsers/registry';
import { ParseButton } from './parse-button';
import { ImportReview } from './import-review';

export const metadata = {
  title: 'Import · gd-finanzas',
};

const STATUS_LABELS: Record<string, string> = {
  uploaded: 'Subido',
  parsing: 'Parseando…',
  parsed: 'Revisar',
  reviewing: 'En revisión',
  confirmed: 'Confirmado',
  error: 'Error',
};

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

export default async function ImportDetailPage({
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
  const [row] = await db
    .select({
      id: imports.id,
      type: imports.type,
      status: imports.status,
      institutionId: imports.institutionId,
      institutionName: institutions.name,
      parserModel: imports.parserModel,
      fileUrl: imports.fileUrl,
      fileHash: imports.fileHash,
      errorMessage: imports.errorMessage,
      transactionCount: imports.transactionCount,
      confirmedAt: imports.confirmedAt,
      createdAt: imports.createdAt,
    })
    .from(imports)
    .leftJoin(institutions, eq(institutions.id, imports.institutionId))
    .where(and(eq(imports.id, id), eq(imports.householdId, session.householdId)))
    .limit(1);

  if (!row) notFound();

  const lines = await db
    .select({
      id: importLines.id,
      parsedData: importLines.parsedData,
      proposedCategoryId: importLines.proposedCategoryId,
      status: importLines.status,
      transactionId: importLines.transactionId,
    })
    .from(importLines)
    .where(eq(importLines.importId, row.id))
    .orderBy(asc(importLines.createdAt));

  const tree = await loadCategoryTree(session.householdId);
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currencyDefault })
    .from(accounts)
    .where(and(eq(accounts.householdId, session.householdId), eq(accounts.archived, false)))
    .orderBy(asc(accounts.name));

  const hasParser =
    row.institutionName !== null && resolveParser(row.institutionName, row.type) !== null;

  const showReview = ['parsed', 'reviewing', 'confirmed'].includes(row.status);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Import</h1>
        <Link href="/imports" className="text-sm text-muted-foreground hover:underline">
          ← Imports
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-3 rounded-md border bg-card p-4 text-sm md:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Institución</dt>
          <dd className="font-medium">{row.institutionName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Tipo</dt>
          <dd className="font-medium">{IMPORT_TYPE_LABELS[row.type]}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Estado</dt>
          <dd className="font-medium">{STATUS_LABELS[row.status] ?? row.status}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Parser</dt>
          <dd className="font-medium">{row.parserModel}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Subido</dt>
          <dd className="font-medium">{formatDate(row.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Confirmado</dt>
          <dd className="font-medium">{formatDate(row.confirmedAt)}</dd>
        </div>
        <div className="col-span-2 md:col-span-3">
          <dt className="text-muted-foreground">Hash SHA-256</dt>
          <dd className="font-mono text-xs">{row.fileHash || '—'}</dd>
        </div>
      </dl>

      {row.errorMessage && (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          <p className="font-medium">Error</p>
          <p>{row.errorMessage}</p>
        </div>
      )}

      {(row.status === 'uploaded' || row.status === 'error') && hasParser && (
        <div className="rounded-md border bg-card p-4">
          <p className="text-sm">
            Parser disponible: <span className="font-medium">{row.institutionName}</span>{' '}
            ({IMPORT_TYPE_LABELS[row.type]}). Al parsear se extraen las transacciones del
            archivo y vas a poder revisarlas antes de confirmar.
          </p>
          <div className="mt-3">
            <ParseButton importId={row.id} />
          </div>
        </div>
      )}

      {!hasParser && row.institutionName && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Parser todavía no implementado para{' '}
          <span className="font-medium">
            {row.institutionName} · {IMPORT_TYPE_LABELS[row.type]}
          </span>
          . Vamos a sumarlo en próximos sub-hitos.
        </div>
      )}

      {row.status === 'parsing' && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Parseando con LLM… esto puede tardar varios segundos. Refrescá la página en un
          rato.
        </div>
      )}

      {showReview && (
        <ImportReview
          importId={row.id}
          status={row.status}
          lines={lines.map((l) => ({
            id: l.id,
            parsedData: l.parsedData as never,
            proposedCategoryId: l.proposedCategoryId,
            status: l.status,
            transactionId: l.transactionId,
          }))}
          tree={tree}
          accounts={accountRows}
        />
      )}
    </div>
  );
}
