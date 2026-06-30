import Link from 'next/link';
import type { PendingActions } from '@/lib/reports/pending-actions';
import { cn } from '@/lib/utils';

type SummaryItem = { label: string; tone: 'attn' | 'bad' };

function buildItems(data: PendingActions): SummaryItem[] {
  const items: SummaryItem[] = [];
  if (data.importsToReview.length > 0) {
    items.push({
      label: `${data.importsToReview.length} import${data.importsToReview.length > 1 ? 's' : ''} para revisar`,
      tone: 'attn',
    });
  }
  if (data.importsErrored.length > 0) {
    items.push({
      label: `${data.importsErrored.length} import${data.importsErrored.length > 1 ? 's' : ''} con error`,
      tone: 'bad',
    });
  }
  if (data.importGaps.length > 0) {
    const months = data.importGaps.reduce((acc, g) => acc + g.missingMonths.length, 0);
    items.push({ label: `${months} resumen${months > 1 ? 'es' : ''} faltante${months > 1 ? 's' : ''}`, tone: 'attn' });
  }
  if (data.overdueForecasts.length > 0) {
    items.push({
      label: `${data.overdueForecasts.length} previsi${data.overdueForecasts.length > 1 ? 'ones' : 'ón'} vencida${data.overdueForecasts.length > 1 ? 's' : ''}`,
      tone: 'bad',
    });
  }
  if (data.budgetMissing) {
    items.push({ label: 'presupuesto del mes sin definir', tone: 'attn' });
  }
  if (data.unmatchedTransfers && data.unmatchedTransfers.length > 0) {
    items.push({
      label: `${data.unmatchedTransfers.length} transferencia${data.unmatchedTransfers.length > 1 ? 's' : ''} sin parear`,
      tone: 'attn',
    });
  }
  return items;
}

export function PendingActionsSummary({ data }: { data: PendingActions }) {
  if (data.totalCount === 0) {
    return (
      <Link
        href="/pendientes"
        className="flex items-center gap-2 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--good)] transition-opacity hover:opacity-80"
      >
        <span aria-hidden>✓</span> Sin acciones pendientes
      </Link>
    );
  }

  const items = buildItems(data);

  return (
    <Link
      href="/pendientes"
      className="group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-[color:var(--attn)]/30 bg-[color:var(--attn)]/[0.06] px-4 py-3 transition-colors hover:border-[color:var(--attn)]/50"
    >
      <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--attn)]">
        Acciones pendientes
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {items.map((it, i) => (
          <span key={i} className="flex items-center gap-3">
            {i > 0 && <span className="text-muted-foreground/40" aria-hidden>·</span>}
            <span
              className={cn(
                'font-display text-base',
                it.tone === 'bad' ? 'text-[color:var(--bad)]' : 'text-foreground',
              )}
            >
              {it.label}
            </span>
          </span>
        ))}
      </span>
      <span className="ml-auto font-display text-sm italic text-muted-foreground group-hover:text-foreground">
        Ver todas →
      </span>
    </Link>
  );
}
