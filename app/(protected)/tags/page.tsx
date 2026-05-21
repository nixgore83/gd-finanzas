import Link from 'next/link';
import { redirect } from 'next/navigation';
import { asc, count, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { tags, transactionTags } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { Button } from '@/components/ui/button';
import { Display, Label, Num, Hair, Body } from '@/components/ui/typography';
import { DeleteTagButton } from './delete-button';

export const metadata = {
  title: 'Etiquetas · gd-finanzas',
};

export default async function TagsPage() {
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
      id: tags.id,
      name: tags.name,
      color: tags.color,
      txCount: count(transactionTags.transactionId),
    })
    .from(tags)
    .leftJoin(transactionTags, eq(transactionTags.tagId, tags.id))
    .where(eq(tags.householdId, session.householdId))
    .groupBy(tags.id, tags.name, tags.color)
    .orderBy(asc(tags.name));

  const totalUses = rows.reduce((s, r) => s + r.txCount, 0);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-6 pt-2">
        <div className="min-w-0">
          <Label>Operar · Etiquetas</Label>
          <Display size="lg" className="mt-2 block">
            Etiquetas
          </Display>
          <Body className="mt-2 max-w-2xl">
            {rows.length === 0 ? (
              <>Sin etiquetas todavía — sirven para cortar transacciones por dimensión libre.</>
            ) : (
              <>
                <span className="text-foreground">{rows.length}</span> etiquetas ·{' '}
                <span className="text-foreground">{totalUses}</span> usos en transacciones
              </>
            )}
          </Body>
        </div>
        <Button asChild size="lg">
          <Link href="/tags/new">+ Nueva etiqueta</Link>
        </Button>
      </header>

      <Hair thick />

      {rows.length === 0 ? (
        <div className="border border-dashed border-border p-12 text-center">
          <Display size="sm">Sin etiquetas</Display>
          <Body className="mx-auto mt-3 max-w-md">
            Las etiquetas son una dimensión libre que se superpone a las categorías —
            sirven para marcar &laquo;reintegrable&raquo;, &laquo;pau&raquo;, &laquo;rabbit-hole&raquo;
            o lo que quieras agrupar.
          </Body>
          <Button asChild className="mt-6" size="lg">
            <Link href="/tags/new">+ Crear la primera</Link>
          </Button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="group flex items-center justify-between gap-4 border border-border bg-card/40 px-4 py-3 transition-colors hover:border-primary/40"
            >
              <Link
                href={`/tags/${row.id}`}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                <span
                  aria-hidden
                  className="inline-block size-3 shrink-0 rounded-full ring-1 ring-border"
                  style={{ background: row.color ?? 'var(--muted)' }}
                />
                <span className="truncate font-mono text-sm text-foreground transition-colors group-hover:text-primary">
                  {row.name}
                </span>
              </Link>
              <div className="flex items-center gap-3">
                <Link
                  href={`/transactions?tagId=${row.id}`}
                  className="link font-mono text-xs text-muted-foreground"
                  title="Ver transacciones con esta etiqueta"
                >
                  <Num>{row.txCount}</Num>
                </Link>
                <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/tags/${row.id}`}>Editar</Link>
                  </Button>
                  <DeleteTagButton id={row.id} name={row.name} txCount={row.txCount} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
