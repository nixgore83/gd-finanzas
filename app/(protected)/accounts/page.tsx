import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, institutions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { ACCOUNT_TYPE_LABELS } from '@/lib/schemas/account';
import { Button } from '@/components/ui/button';
import { setAccountArchived } from '@/app/actions/accounts/archive';

async function toggleArchive(formData: FormData): Promise<void> {
  'use server';
  await setAccountArchived(formData);
}

export const metadata = {
  title: 'Cuentas · gd-finanzas',
};

type SearchParams = Promise<{ archived?: string }>;

export default async function AccountsPage({ searchParams }: { searchParams: SearchParams }) {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const params = await searchParams;
  const showArchived = params.archived === '1';

  const db = getDb();
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      currencyDefault: accounts.currencyDefault,
      institutionName: institutions.name,
      ownerTag: accounts.ownerTag,
      archived: accounts.archived,
    })
    .from(accounts)
    .leftJoin(institutions, eq(accounts.institutionId, institutions.id))
    .where(
      showArchived
        ? eq(accounts.householdId, session.householdId)
        : and(eq(accounts.householdId, session.householdId), eq(accounts.archived, false)),
    )
    .orderBy(asc(accounts.name));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Cuentas</h1>
        <Button asChild>
          <Link href="/accounts/new">+ Nueva cuenta</Link>
        </Button>
      </div>

      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Link
          href="/accounts"
          className={!showArchived ? 'font-medium text-foreground' : 'hover:underline'}
        >
          Activas
        </Link>
        <span>·</span>
        <Link
          href="/accounts?archived=1"
          className={showArchived ? 'font-medium text-foreground' : 'hover:underline'}
        >
          Todas (incluye archivadas)
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {showArchived
            ? 'No hay cuentas todavía.'
            : 'No hay cuentas activas. Crear una con "+ Nueva cuenta".'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Nombre</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Moneda</th>
                <th className="px-3 py-2 font-medium">Institución</th>
                <th className="px-3 py-2 font-medium">Titular</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2">
                    <Link href={`/accounts/${row.id}`} className="hover:underline">
                      {row.name}
                    </Link>
                    {row.archived && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        archivada
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {ACCOUNT_TYPE_LABELS[row.type]}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.currencyDefault}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.institutionName ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.ownerTag}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/accounts/${row.id}`}>Editar</Link>
                      </Button>
                      <form action={toggleArchive}>
                        <input type="hidden" name="id" value={row.id} />
                        <input
                          type="hidden"
                          name="archived"
                          value={row.archived ? 'false' : 'true'}
                        />
                        <Button variant="ghost" size="sm" type="submit">
                          {row.archived ? 'Reactivar' : 'Archivar'}
                        </Button>
                      </form>
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
