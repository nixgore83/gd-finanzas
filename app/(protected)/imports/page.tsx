import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, imports, importLines, institutions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { IMPORT_TYPE_LABELS } from '@/lib/schemas/import';
import { Button } from '@/components/ui/button';
import { Display, Label, Num, Hair, Body } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Imports · gd-finanzas',
};

const STATUS_LABELS: Record<string, string> = {
  uploaded: 'Subido',
  parsing: 'Parseando',
  parsed: 'Revisar',
  reviewing: 'En revisión',
  confirmed: 'Confirmado',
  error: 'Error',
};

const STATUS_VARS: Record<string, string> = {
  uploaded: 'var(--muted-foreground)',
  parsing: 'var(--attn)',
  parsed: 'var(--attn)',
  reviewing: 'var(--attn)',
  confirmed: 'var(--good)',
  error: 'var(--bad)',
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

function relativeAgo(d: Date | null): string {
  if (!d) return '';
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;
  if (days < 30) return `hace ${Math.floor(days / 7)} sem`;
  return `hace ${Math.floor(days / 30)} meses`;
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
      accountName: accounts.name,
      accountOwner: accounts.ownerTag,
      createdAt: imports.createdAt,
      transactionCount: imports.transactionCount,
    })
    .from(imports)
    .leftJoin(institutions, eq(institutions.id, imports.institutionId))
    .leftJoin(accounts, eq(accounts.id, imports.accountId))
    .where(eq(imports.householdId, session.householdId))
    .orderBy(desc(imports.createdAt))
    .limit(50);

  // Derive period (month range) from import_lines dates
  const periodByImport = new Map<string, string>();
  if (rows.length > 0) {
    const periods = await db
      .select({
        importId: importLines.importId,
        minDate: sql<string>`min(${importLines.parsedData}->>'date')`,
        maxDate: sql<string>`max(${importLines.parsedData}->>'date')`,
      })
      .from(importLines)
      .where(sql`${importLines.importId} in ${rows.map((r) => r.id)}`)
      .groupBy(importLines.importId);

    for (const p of periods) {
      if (!p.minDate) continue;
      const minMonth = p.minDate.slice(0, 7); // YYYY-MM
      const maxMonth = p.maxDate?.slice(0, 7) ?? minMonth;
      const fmt = (ym: string) => {
        const [y, m] = ym.split('-');
        const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        return `${months[parseInt(m!, 10) - 1]} ${y}`;
      };
      periodByImport.set(
        p.importId,
        minMonth === maxMonth ? fmt(minMonth) : `${fmt(minMonth)} – ${fmt(maxMonth)}`,
      );
    }
  }

  const totalLines = rows.reduce((s, r) => s + (r.transactionCount ?? 0), 0);
  const pendingReview = rows.filter((r) => r.status === 'parsed' || r.status === 'reviewing').length;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-6 pt-2">
        <div className="min-w-0">
          <Label>Tools · Imports</Label>
          <Display size="lg" className="mt-2 block">
            Imports
          </Display>
          <Body className="mt-2 max-w-2xl">
            {rows.length === 0 ? (
              <>Sin imports todavía. Subí un resumen para empezar.</>
            ) : (
              <>
                <span className="text-foreground">{rows.length}</span> archivos ·{' '}
                <span className="text-foreground">{totalLines}</span> líneas parseadas
                {pendingReview > 0 && (
                  <>
                    {' '}·{' '}
                    <span className="text-[color:var(--attn)]">{pendingReview}</span>{' '}
                    en revisión
                  </>
                )}
              </>
            )}
          </Body>
        </div>
        <Button asChild size="lg">
          <Link href="/imports/new">+ Subir extracto</Link>
        </Button>
      </header>

      <Hair thick />

      {rows.length === 0 ? (
        <div className="border border-dashed border-border p-12 text-center">
          <Display size="sm">Sin imports todavía</Display>
          <Body className="mx-auto mt-3 max-w-md">
            Subí un PDF o CSV de resumen de banco / TC / broker. El parser LLM lo procesa,
            vos revisás y confirmás las transacciones.
          </Body>
          <Button asChild className="mt-6" size="lg">
            <Link href="/imports/new">+ Subir el primero</Link>
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-y border-border">
                {['Fecha', 'Cuenta', 'Período', 'Estado'].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-left font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Txns
                </th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const statusVar = STATUS_VARS[r.status] ?? 'var(--muted-foreground)';
                const needsAttention = r.status === 'parsed' || r.status === 'reviewing';
                return (
                  <tr
                    key={r.id}
                    className="group border-t border-border/40 transition-colors hover:bg-primary/[0.04]"
                  >
                    <td className="px-3 py-3">
                      <Num className="block text-sm text-foreground">
                        {formatDate(r.createdAt)}
                      </Num>
                      <Label className="mt-0.5 normal-case tracking-[0.05em]">
                        {relativeAgo(r.createdAt)}
                      </Label>
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/imports/${r.id}`}
                        className="text-sm font-medium text-foreground transition-colors hover:text-primary"
                      >
                        {r.accountName ?? r.institutionName ?? '—'}
                        {r.accountOwner ? ` (${r.accountOwner})` : ''}
                      </Link>
                      <Label className="mt-0.5 block normal-case tracking-[0.05em]">
                        {r.institutionName} · {IMPORT_TYPE_LABELS[r.type]}
                      </Label>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-sm text-foreground">
                        {periodByImport.get(r.id) ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          'inline-block rounded-full border px-2.5 py-[3px] font-sans text-[10px] font-semibold uppercase tracking-[0.14em]',
                          needsAttention && 'animate-pulse',
                        )}
                        style={{
                          borderColor: `color-mix(in oklab, ${statusVar} 40%, transparent)`,
                          background: `color-mix(in oklab, ${statusVar} 12%, transparent)`,
                          color: statusVar,
                        }}
                      >
                        {STATUS_LABELS[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Num className="text-sm text-foreground">
                        {r.transactionCount ?? '—'}
                      </Num>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/imports/${r.id}`}>Ver →</Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
