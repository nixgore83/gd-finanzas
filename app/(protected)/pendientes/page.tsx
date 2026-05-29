import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadPendingActions } from '@/lib/reports/pending-actions';
import { IMPORT_TYPE_LABELS } from '@/lib/schemas/import';
import { Display, Label, Num, Hair, Body } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Pendientes · gd-finanzas' };

const MONTHS_SHORT = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

function formatAmount(amount: string, currency: 'ARS' | 'USD'): string {
  const n = Number.parseFloat(amount);
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function shortDate(iso: string): string {
  const parts = iso.split('-');
  const m = parts[1];
  const d = parts[2];
  if (!m || !d) return iso;
  const mi = Number.parseInt(m, 10) - 1;
  return `${d} ${MONTHS_SHORT[mi] ?? ''}`;
}

function monthChip(iso: string): string {
  // 'YYYY-MM' → 'may 26'
  const parts = iso.split('-');
  const y = parts[0];
  const m = parts[1];
  if (!y || !m) return iso;
  const mi = Number.parseInt(m, 10) - 1;
  return `${MONTHS_SHORT[mi] ?? m} ${y.slice(2)}`;
}

export default async function PendientesPage() {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const data = await loadPendingActions(session.householdId);
  const allClear = data.totalCount === 0;

  return (
    <div className="space-y-10">
      {/* ============ HERO ============ */}
      <section className="pt-2">
        <Label>Acciones pendientes</Label>
        <Display size="xl" className="mt-3 block tabular-nums">
          {data.totalCount}
        </Display>
        <Body className="mt-2 max-w-xl">
          {allClear
            ? 'No hay nada que requiera tu atención. Todo al día.'
            : 'Cosas que necesitan que hagas algo: importaciones por revisar, resúmenes faltantes, previsiones vencidas y presupuesto del mes.'}
        </Body>
      </section>

      <Hair thick />

      {allClear ? (
        <section className="py-10 text-center">
          <Display size="md" className="text-[color:var(--good)]">
            ✓ Todo al día
          </Display>
          <Body className="mt-2">No tenés acciones pendientes.</Body>
        </section>
      ) : (
        <div className="space-y-12">
          {/* ===== Importaciones para revisar ===== */}
          {data.importsToReview.length > 0 && (
            <PendingSection
              title="Importaciones para revisar"
              hint={`${data.importsToReview.length} esperando confirmación`}
            >
              <ul className="divide-y divide-border/60">
                {data.importsToReview.map((imp) => (
                  <li key={imp.id}>
                    <Link
                      href={`/imports/${imp.id}`}
                      className="grid grid-cols-[1fr_auto] items-center gap-3 py-3 transition-colors hover:bg-primary/[0.04]"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-display text-base text-foreground">
                          {imp.fileName ?? 'Importación sin nombre'}
                        </div>
                        <div className="mt-0.5 font-sans text-xs text-muted-foreground">
                          {IMPORT_TYPE_LABELS[imp.type]}
                          {imp.institutionName ? ` · ${imp.institutionName}` : ''}
                          {imp.accountName ? ` · ${imp.accountName}` : ''}
                        </div>
                      </div>
                      <StatusChip
                        label={imp.status === 'parsed' ? 'Revisar' : 'En revisión'}
                        tone="attn"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </PendingSection>
          )}

          {/* ===== Importaciones con error ===== */}
          {data.importsErrored.length > 0 && (
            <PendingSection
              title="Importaciones con error"
              hint={`${data.importsErrored.length} fallaron`}
            >
              <ul className="divide-y divide-border/60">
                {data.importsErrored.map((imp) => (
                  <li key={imp.id}>
                    <Link
                      href={`/imports/${imp.id}`}
                      className="grid grid-cols-[1fr_auto] items-center gap-3 py-3 transition-colors hover:bg-primary/[0.04]"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-display text-base text-foreground">
                          {imp.fileName ?? 'Importación sin nombre'}
                        </div>
                        <div className="mt-0.5 truncate font-sans text-xs text-[color:var(--bad)]">
                          {imp.errorMessage ?? 'Error al procesar'}
                        </div>
                      </div>
                      <StatusChip label="Error" tone="bad" />
                    </Link>
                  </li>
                ))}
              </ul>
            </PendingSection>
          )}

          {/* ===== Resúmenes mensuales faltantes ===== */}
          {data.importGaps.length > 0 && (
            <PendingSection
              title="Resúmenes mensuales faltantes"
              hint="cuentas con import mensual esperado"
            >
              <ul className="divide-y divide-border/60">
                {data.importGaps.map((gap) => (
                  <li
                    key={gap.accountId}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <div className="font-display text-base text-foreground">
                        {gap.accountName}
                      </div>
                      {gap.institutionName && (
                        <div className="mt-0.5 font-sans text-xs text-muted-foreground">
                          {gap.institutionName}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {gap.missingMonths.map((m) => (
                        <span
                          key={m}
                          className="rounded-sm bg-[color:var(--attn)]/15 px-2 py-[3px] font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--attn)]"
                        >
                          {monthChip(m)}
                        </span>
                      ))}
                      <Link
                        href="/imports/new"
                        className="link font-display text-sm italic text-muted-foreground"
                      >
                        Importar →
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </PendingSection>
          )}

          {/* ===== Previsiones vencidas ===== */}
          {data.overdueForecasts.length > 0 && (
            <PendingSection
              title="Previsiones vencidas"
              hint={`${data.overdueForecasts.length} sin confirmar`}
            >
              <ul className="divide-y divide-border/60">
                {data.overdueForecasts.map((f) => (
                  <li
                    key={f.id}
                    className="grid grid-cols-[56px_1fr_auto] items-center gap-3 py-3"
                  >
                    <Num className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                      {shortDate(f.expectedDate)}
                    </Num>
                    <div className="min-w-0">
                      <div className="truncate font-display text-base text-foreground">
                        {f.recurrenceName}
                      </div>
                      <StatusChip
                        label={f.overdueKind === 'missed' ? 'Vencida' : 'En gracia'}
                        tone={f.overdueKind === 'missed' ? 'bad' : 'attn'}
                        className="mt-1"
                      />
                    </div>
                    <Num className="text-sm text-foreground">
                      {formatAmount(f.expectedAmount, f.currency)}
                    </Num>
                  </li>
                ))}
              </ul>
              <Link
                href="/forecasts"
                className="link mt-4 inline-block font-display text-sm italic text-muted-foreground"
              >
                Gestionar previsiones →
              </Link>
            </PendingSection>
          )}

          {/* ===== Presupuesto del mes ===== */}
          {data.budgetMissing && (
            <PendingSection title="Presupuesto del mes" hint="sin definir">
              <div className="flex flex-wrap items-center justify-between gap-3 py-3">
                <Body className="max-w-md">
                  Todavía no cargaste el presupuesto del mes en curso.
                </Body>
                <Link
                  href="/budget"
                  className="link font-display text-sm italic text-muted-foreground"
                >
                  Definir presupuesto →
                </Link>
              </div>
            </PendingSection>
          )}
        </div>
      )}
    </div>
  );
}

function PendingSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between">
        <Display size="md">{title}</Display>
        <Label>{hint}</Label>
      </div>
      <Hair className="mt-3 mb-1" />
      {children}
    </section>
  );
}

function StatusChip({
  label,
  tone,
  className,
}: {
  label: string;
  tone: 'attn' | 'bad' | 'good';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-block rounded-sm px-2 py-[3px] font-sans text-[9px] font-semibold uppercase tracking-[0.14em]',
        tone === 'attn' && 'bg-[color:var(--attn)]/15 text-[color:var(--attn)]',
        tone === 'bad' && 'bg-[color:var(--bad)]/15 text-[color:var(--bad)]',
        tone === 'good' && 'bg-[color:var(--good)]/15 text-[color:var(--good)]',
        className,
      )}
    >
      {label}
    </span>
  );
}
