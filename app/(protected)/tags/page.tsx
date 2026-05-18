import Link from 'next/link';
import { redirect } from 'next/navigation';
import { asc, count, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { tags, transactionTags } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { Button } from '@/components/ui/button';
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Etiquetas</h1>
        <Button asChild>
          <Link href="/tags/new">+ Nueva etiqueta</Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Sin etiquetas todavía. Cargá la primera.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Color</th>
                <th className="px-3 py-2 font-medium">Nombre</th>
                <th className="px-3 py-2 font-medium">Transacciones</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2">
                    {row.color ? (
                      <span
                        className="inline-block h-4 w-4 rounded border"
                        style={{ backgroundColor: row.color }}
                        aria-label={row.color}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/tags/${row.id}`} className="hover:underline">
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.txCount}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/tags/${row.id}`}>Editar</Link>
                      </Button>
                      <DeleteTagButton id={row.id} name={row.name} txCount={row.txCount} />
                    </div>
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
