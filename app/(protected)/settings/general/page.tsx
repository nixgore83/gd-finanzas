import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { householdSettings } from '@/db/schema';
import { Display, Body } from '@/components/ui/typography';
import { AutoMatchToggle } from './auto-match-toggle';

export const metadata = {
  title: 'General · gd-finanzas',
};

export default async function GeneralSettingsPage() {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/auth/login');
    throw err;
  }

  const db = getDb();
  const [settings] = await db
    .select({ autoMatchForecasts: householdSettings.autoMatchForecasts })
    .from(householdSettings)
    .where(eq(householdSettings.householdId, session.householdId))
    .limit(1);

  const autoMatch = settings?.autoMatchForecasts ?? false;

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-8">
      <Display>General</Display>

      <section className="space-y-4">
        <h2 className="font-display text-lg text-foreground">Previsiones</h2>
        <div className="rounded-lg border border-border p-4">
          <AutoMatchToggle defaultValue={autoMatch} />
          <Body className="mt-2 text-muted-foreground">
            Cuando está activo, las transacciones nuevas (manuales e importadas) se linkean
            automáticamente con previsiones pendientes si coinciden en cuenta, tipo, monto (±10%)
            y fecha (±5 días). Solo matchea cuando hay un único candidato claro.
          </Body>
        </div>
      </section>
    </div>
  );
}
