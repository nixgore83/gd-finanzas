import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { getMfaState } from '@/lib/auth/mfa';
import { getDb } from '@/lib/db/client';
import { householdMembers, profiles } from '@/db/schema';
import { countPendingActions } from '@/lib/reports/pending-actions';
import { Sidebar } from '@/components/nav/sidebar';
import { MobileNav } from '@/components/nav/mobile-nav';
import { ThemeToggle } from '@/components/theme/theme-toggle';

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

  const displayName = profile?.displayName ?? user.email ?? null;

  const pendingCount = await countPendingActions(membership.householdId);
  const navBadges = { '/pendientes': pendingCount };

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <div className="hidden md:flex md:shrink-0">
        <Sidebar userDisplayName={displayName} badges={navBadges} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar: hamburguesa + brand + theme toggle */}
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:hidden">
          <div className="flex items-center gap-3">
            <MobileNav userDisplayName={displayName} badges={navBadges} />
            <span className="text-sm font-semibold">gd-finanzas</span>
          </div>
          <ThemeToggle />
        </header>

        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
