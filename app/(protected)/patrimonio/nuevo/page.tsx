import { redirect } from 'next/navigation';
import { eq, and } from 'drizzle-orm';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { accounts, institutions } from '@/db/schema';
import { loadSnapshots } from '@/lib/patrimonio/load-snapshots';
import { loadSnapshotDetail } from '@/lib/patrimonio/load-snapshot-detail';
import { getFxRate } from '@/lib/fx/get-fx-rate';
import { Display, Label } from '@/components/ui/typography';
import { SnapshotForm } from '../snapshot-form';

export const metadata = { title: 'Nuevo snapshot · gd-finanzas' };

export default async function NuevoSnapshotPage() {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const db = getDb();

  // Load active accounts
  const accountRows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      cardBrand: accounts.cardBrand,
      institutionName: institutions.name,
      currencyDefault: accounts.currencyDefault,
      ownerTag: accounts.ownerTag,
    })
    .from(accounts)
    .leftJoin(institutions, eq(accounts.institutionId, institutions.id))
    .where(
      and(
        eq(accounts.householdId, session.householdId),
        eq(accounts.archived, false),
      ),
    )
    .orderBy(accounts.name);

  // Get latest snapshot for pre-fill
  const allSnapshots = await loadSnapshots(session.householdId);
  const latestId = allSnapshots[0]?.id;
  const previousDetail = latestId
    ? await loadSnapshotDetail(latestId, session.householdId)
    : null;

  // Get today's FX rate for ARS conversion
  const today = new Date().toISOString().slice(0, 10);
  let todayFxRate: string | null = null;
  try {
    const fx = await getFxRate({ date: today });
    todayFxRate = fx.rate.toString();
  } catch {
    // No rate available — user will need to enter manually
  }

  return (
    <div className="space-y-8">
      <header className="pt-2">
        <Label>Patrimonio · Nuevo snapshot</Label>
        <Display size="lg" className="mt-3 block">
          Registrar patrimonio
        </Display>
      </header>

      <SnapshotForm
        accounts={accountRows}
        previousDetail={previousDetail}
        defaultFxRate={todayFxRate}
        defaultDate={today}
      />
    </div>
  );
}
