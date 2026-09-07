import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, institutions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { ACCOUNT_TYPE_LABELS, type CARD_BRANDS } from '@/lib/schemas/account';
import { formatAccount } from '@/lib/accounts/format';
import { Button } from '@/components/ui/button';
import { Display, Label, Body, Hair } from '@/components/ui/typography';
import { setAccountArchived } from '@/app/actions/accounts/archive';
import { cn } from '@/lib/utils';

async function toggleArchive(formData: FormData): Promise<void> {
  'use server';
  await setAccountArchived(formData);
}

export const metadata = {
  title: 'Cuentas · gd-finanzas',
};

type SearchParams = Promise<{ archived?: string }>;

type AccountRow = {
  id: string;
  name: string;
  type: keyof typeof ACCOUNT_TYPE_LABELS;
  cardBrand: (typeof CARD_BRANDS)[number] | null;
  currencyDefault: 'ARS' | 'USD';
  institutionName: string | null;
  ownerTag: string;
  archived: boolean;
  expectsMonthlyImport: boolean;
};

/**
 * Título de la fila dentro de su sección (la institución ya es el header):
 * el producto + rótulo. Para ewallet/other no hay producto → cae al tipo.
 */
function rowTitle(row: AccountRow): string {
  const product = formatAccount(
    {
      institutionName: row.institutionName,
      type: row.type,
      cardBrand: row.cardBrand,
      name: row.name,
      ownerTag: row.ownerTag,
      currency: row.currencyDefault,
    },
    { withInstitution: false, withOwner: false, withCurrency: false },
  );
  return product === '—' ? ACCOUNT_TYPE_LABELS[row.type] : product;
}

/** Bullet color by account type — keeps the page scannable at a glance. */
function dotVarFor(type: AccountRow['type']): string {
  if (type === 'credit_card') return 'var(--bad)'; // debt-bearing
  if (type === 'broker') return 'var(--attn)'; // investment vehicle
  if (type === 'cash') return 'var(--muted-foreground)';
  return 'var(--good)'; // bank / wallet / etc
}

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
  const rows: AccountRow[] = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      cardBrand: accounts.cardBrand,
      currencyDefault: accounts.currencyDefault,
      institutionName: institutions.name,
      ownerTag: accounts.ownerTag,
      archived: accounts.archived,
      expectsMonthlyImport: accounts.expectsMonthlyImport,
    })
    .from(accounts)
    .leftJoin(institutions, eq(accounts.institutionId, institutions.id))
    .where(
      showArchived
        ? eq(accounts.householdId, session.householdId)
        : and(eq(accounts.householdId, session.householdId), eq(accounts.archived, false)),
    )
    .orderBy(asc(institutions.name), asc(accounts.type), asc(accounts.name));

  // Group by institution (null → "Sin institución" bucket, useful for Cash).
  const byBank = new Map<string, AccountRow[]>();
  for (const r of rows) {
    const key = r.institutionName ?? 'Sin institución';
    const arr = byBank.get(key) ?? [];
    arr.push(r);
    byBank.set(key, arr);
  }
  const groups = [...byBank.entries()].sort(([a], [b]) => a.localeCompare(b, 'es'));

  const activeCount = rows.filter((r) => !r.archived).length;
  const archivedCount = rows.filter((r) => r.archived).length;

  return (
    <div className="space-y-8">
      {/* ============ HEADER ============ */}
      <header className="flex flex-wrap items-end justify-between gap-6 pt-2">
        <div className="min-w-0">
          <Label>Operar · Cuentas</Label>
          <Display size="lg" className="mt-2 block">
            Cuentas
          </Display>
          <Body className="mt-2 max-w-2xl">
            {rows.length === 0 ? (
              <>Todavía no hay cuentas cargadas. Arrancá creando la primera.</>
            ) : (
              <>
                <span className="text-foreground not-italic">{activeCount}</span>{' '}
                {activeCount === 1 ? 'activa' : 'activas'} ·{' '}
                <span className="text-foreground not-italic">{groups.length}</span>{' '}
                {groups.length === 1 ? 'institución' : 'instituciones'}
                {showArchived && archivedCount > 0 && (
                  <>
                    {' '}
                    · <span className="text-foreground not-italic">{archivedCount}</span> archivada
                    {archivedCount === 1 ? '' : 's'}
                  </>
                )}
              </>
            )}
          </Body>
        </div>
        <Button asChild size="lg">
          <Link href="/accounts/new">+ Nueva cuenta</Link>
        </Button>
      </header>

      <Hair thick />

      {/* ============ FILTER PILLS ============ */}
      <nav className="flex items-baseline gap-1" aria-label="Filtros de archivado">
        <FilterPill href="/accounts" active={!showArchived}>
          Activas
        </FilterPill>
        <FilterPill href="/accounts?archived=1" active={showArchived}>
          Incluir archivadas
        </FilterPill>
      </nav>

      {/* ============ BODY ============ */}
      {rows.length === 0 ? (
        <div className="border-border border border-dashed p-12 text-center">
          <Display size="sm">Sin cuentas todavía</Display>
          <Body className="mx-auto mt-3 max-w-md">
            Las cuentas son el lugar donde &laquo;vive&raquo; el dinero — una caja de ahorro, una
            tarjeta, una billetera virtual, cash. Después conectás recurrencias y transacciones a
            ellas.
          </Body>
          <Button asChild className="mt-6" size="lg">
            <Link href="/accounts/new">+ Crear la primera</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-10">
          {groups.map(([bankName, bankAccounts]) => (
            <BankSection
              key={bankName}
              name={bankName}
              accounts={bankAccounts}
              toggleArchive={toggleArchive}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-block px-3 py-1.5 font-sans text-[10px] font-semibold tracking-[0.18em] uppercase transition-colors',
        active
          ? 'border-primary text-primary border-b-2'
          : 'text-muted-foreground hover:text-foreground border-b-2 border-transparent',
      )}
    >
      {children}
    </Link>
  );
}

function BankSection({
  name,
  accounts: bankAccounts,
  toggleArchive,
}: {
  name: string;
  accounts: AccountRow[];
  toggleArchive: (formData: FormData) => Promise<void>;
}) {
  return (
    <section>
      <header className="border-border flex items-baseline justify-between border-b pb-2">
        <div className="flex items-baseline gap-3">
          <Display size="sm">{name}</Display>
          <Label>
            {bankAccounts.length} {bankAccounts.length === 1 ? 'cuenta' : 'cuentas'}
          </Label>
        </div>
      </header>

      <ul>
        {bankAccounts.map((row) => (
          <li
            key={row.id}
            className={cn(
              'group border-border/40 hover:bg-primary/[0.04] grid grid-cols-[16px_minmax(0,1fr)_80px_140px_auto] items-center gap-4 border-b py-4 transition-colors',
              row.archived && 'opacity-60',
            )}
          >
            {/* Dot */}
            <span
              aria-hidden
              className="inline-block size-2 rounded-full"
              style={{ background: dotVarFor(row.type) }}
            />

            {/* Name + type/archived */}
            <div className="min-w-0">
              <Link
                href={`/accounts/${row.id}`}
                className="font-display text-foreground hover:text-primary block text-lg"
              >
                {rowTitle(row)}
                {row.expectsMonthlyImport && (
                  <span className="ml-2 inline-block rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 align-middle text-[9px] font-semibold tracking-wide text-amber-800 uppercase dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    Import mensual
                  </span>
                )}
              </Link>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
                <Label className="text-muted-foreground tracking-[0.14em] normal-case">
                  {ACCOUNT_TYPE_LABELS[row.type]}
                </Label>
                {row.ownerTag && (
                  <Label className="text-muted-foreground tracking-[0.14em] normal-case">
                    · {row.ownerTag}
                  </Label>
                )}
                {row.archived && (
                  <span
                    className="rounded-full px-2 py-[1px] font-sans text-[9px] font-semibold tracking-[0.18em] uppercase"
                    style={{
                      background: 'color-mix(in oklab, var(--muted-foreground) 14%, transparent)',
                      color: 'var(--muted-foreground)',
                    }}
                  >
                    archivada
                  </span>
                )}
              </div>
            </div>

            {/* Currency pill */}
            <div>
              <span
                className="inline-block rounded-full border px-2.5 py-[3px] font-sans text-[10px] font-semibold tracking-[0.18em] uppercase"
                style={{
                  borderColor: 'color-mix(in oklab, var(--primary) 40%, transparent)',
                  color: 'var(--primary)',
                }}
              >
                {row.currencyDefault}
              </span>
            </div>

            {/* Spacer (era institución, ahora redundante) */}
            <div className="font-display text-muted-foreground text-sm italic">
              {/* placeholder for future: balance, last activity, etc */}
            </div>

            {/* Actions — quiet by default, full on hover/focus */}
            <div className="flex justify-end gap-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/accounts/${row.id}`}>Editar</Link>
              </Button>
              <form action={toggleArchive}>
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="archived" value={row.archived ? 'false' : 'true'} />
                <Button variant="ghost" size="sm" type="submit">
                  {row.archived ? 'Reactivar' : 'Archivar'}
                </Button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
