import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { getMfaState } from '@/lib/auth/mfa';
import { getDb } from '@/lib/db/client';
import { householdMembers, profiles } from '@/db/schema';

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/accounts', label: 'Cuentas' },
  { href: '/transactions', label: 'Transacciones' },
  { href: '/recurrences', label: 'Recurrencias' },
  { href: '/forecasts', label: 'Previsiones' },
  { href: '/budget', label: 'Presupuesto' },
  { href: '/reports/cashflow', label: 'Reportes' },
  { href: '/tags', label: 'Etiquetas' },
];

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const mfaState = await getMfaState(supabase);
  if (mfaState === 'enroll') redirect('/auth/mfa/enroll');
  if (mfaState === 'challenge') redirect('/auth/mfa/challenge');

  const db = getDb();
  const [membership] = await db
    .select({ householdId: householdMembers.householdId })
    .from(householdMembers)
    .where(eq(householdMembers.userId, user.id))
    .limit(1);

  if (!membership) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4">
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-xl font-semibold">Tu cuenta aún no está vinculada</h1>
          <p className="text-sm text-muted-foreground">
            Tu usuario está creado pero no pertenece a ningún household. Avisale a Nico para
            correr el seed inicial.
          </p>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="text-sm underline underline-offset-4 hover:opacity-80"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </main>
    );
  }

  const [profile] = await db
    .select({ displayName: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-5">
            <span className="text-sm font-medium">gd-finanzas</span>
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="hover:text-foreground hover:underline underline-offset-4"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{profile?.displayName ?? user.email}</span>
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="text-sm underline underline-offset-4 hover:opacity-80"
              >
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</div>
    </div>
  );
}
