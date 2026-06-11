import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, imports, importLines, institutions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { IMPORT_TYPE_LABELS } from '@/lib/schemas/import';
import { loadCategoryTree } from '@/lib/categories/tree';
import { resolveParser } from '@/lib/imports/parsers/registry';
import { generateSignedUrl } from '@/lib/imports/storage';
import { isParseStale } from '@/lib/imports/parse-stale';
import { isDeletableStatus } from '@/lib/imports/list-filters';
import { ParseButton } from './parse-button';
import { DeleteImportButton } from './delete-import-button';
import { ImportReview } from './import-review';

export const metadata = {
  title: 'Import · gd-finanzas',
};

// `parseImport` (llamada síncrona al LLM, 5-15s típicos pero un PDF grande puede
// más) y `confirmImport` (crea N transacciones) corren en el contexto de esta
// ruta. Le damos margen amplio para evitar 504 en el parseo (ver STATUS.md).
export const maxDuration = 300;

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
      accountId: imports.accountId,
      institutionName: institutions.name,
      parserModel: imports.parserModel,
      fileUrl: imports.fileUrl,
      fileHash: imports.fileHash,
      fileName: imports.fileName,
      summary: imports.summary,
      statementAccountRef: imports.statementAccountRef,
      parsingStartedAt: imports.parsingStartedAt,
      errorMessage: imports.errorMessage,
      transactionCount: imports.transactionCount,
      confirmedAt: imports.confirmedAt,
      createdAt: imports.createdAt,
      pdfPassword: institutions.pdfPassword,
      accountPdfPassword: accounts.pdfPassword,
    })
    .from(imports)
    .leftJoin(institutions, eq(institutions.id, imports.institutionId))
    .leftJoin(accounts, eq(accounts.id, imports.accountId))
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
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      cardBrand: accounts.cardBrand,
      currency: accounts.currencyDefault,
      institutionId: accounts.institutionId,
      institutionName: institutions.name,
      ownerTag: accounts.ownerTag,
      accountNumber: accounts.accountNumber,
    })
    .from(accounts)
    .leftJoin(institutions, eq(accounts.institutionId, institutions.id))
    .where(and(eq(accounts.householdId, session.householdId), eq(accounts.archived, false)))
    .orderBy(asc(institutions.name), asc(accounts.type), asc(accounts.name));

  // Auto-sugerencia de cuenta destino: si el parser extrajo el nº de cuenta del
  // extracto y matchea una cuenta ya "aprendida", la preseleccionamos.
  const suggestedAccountId = row.statementAccountRef
    ? accountRows.find((a) => a.accountNumber && a.accountNumber === row.statementAccountRef)?.id ?? null
    : null;

  const hasParser =
    row.institutionName !== null && resolveParser(row.institutionName, row.type) !== null;

  const showReview = ['parsed', 'reviewing', 'confirmed'].includes(row.status);

  // El parseo corre async; si quedó en 'parsing' más del umbral, se cortó.
  const parseStale = isParseStale(row.parsingStartedAt, new Date());

  // Generate signed URL for PDF viewing (1 hour expiry)
  const pdfUrl = row.fileUrl ? await generateSignedUrl(row.fileUrl) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Import</h1>
          {row.fileName && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">{row.fileName}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {isDeletableStatus(row.status) && <DeleteImportButton importId={row.id} />}
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Ver PDF ↗
            </a>
          )}
          <Link href="/imports" className="text-sm text-muted-foreground hover:underline">
            ← Imports
          </Link>
        </div>
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
        <div
          className={
            row.status === 'reviewing'
              ? 'rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900'
              : 'rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900'
          }
        >
          <p className="font-medium">
            {row.status === 'reviewing' ? 'Atención' : 'Error'}
          </p>
          <p>{row.errorMessage}</p>
          {row.status === 'reviewing' && (
            <p className="mt-1 text-xs">
              Las líneas sin transacción quedaron editables. Reintentá &ldquo;Confirmar
              import&rdquo; tras corregir (o backfill de FX si fue ese el problema).
            </p>
          )}
        </div>
      )}

      {(row.status === 'uploaded' || row.status === 'error' || row.status === 'parsed' || row.status === 'reviewing') && hasParser && (
        <div className="rounded-md border bg-card p-4">
          <p className="text-sm">
            Parser disponible: <span className="font-medium">{row.institutionName}</span>{' '}
            ({IMPORT_TYPE_LABELS[row.type]}). Al parsear se extraen las transacciones del
            archivo y vas a poder revisarlas antes de confirmar.
          </p>
          <div className="mt-3">
            <ParseButton
              importId={row.id}
              isPdf={!row.fileUrl?.toLowerCase().endsWith('.csv')}
              hasStoredPassword={!!(row.accountPdfPassword || row.pdfPassword)}
            />
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
        <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {parseStale ? (
            <p className="font-medium">
              El parseo se cortó (excedió el límite de tiempo). Reintentá abajo.
            </p>
          ) : (
            <p>
              Parseando con LLM en segundo plano… esto puede tardar hasta un par de
              minutos. Refrescá la página en un rato.
            </p>
          )}
          {hasParser && (
            <div className="space-y-2 border-t border-amber-200 pt-3">
              {!parseStale && (
                <p className="text-xs">
                  ¿Quedó trabado? Si pasaron varios minutos y sigue acá, reintentá:
                </p>
              )}
              <ParseButton
                importId={row.id}
                isPdf={!row.fileUrl?.toLowerCase().endsWith('.csv')}
                hasStoredPassword={!!(row.accountPdfPassword || row.pdfPassword)}
              />
            </div>
          )}
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
          importInstitutionId={row.institutionId}
          importAccountId={row.accountId}
          statementAccountRef={row.statementAccountRef ?? null}
          suggestedAccountId={suggestedAccountId}
          pdfUrl={pdfUrl}
          summary={row.summary ?? null}
        />
      )}
    </div>
  );
}
