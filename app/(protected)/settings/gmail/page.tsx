import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, institutions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { Display, Label, Body } from '@/components/ui/typography';
import { GmailLabelConfig } from './gmail-label-config';

export const metadata = { title: 'Gmail · gd-finanzas' };

export default async function GmailSettingsPage() {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const db = getDb();
  const accountRows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      cardBrand: accounts.cardBrand,
      currencyDefault: accounts.currencyDefault,
      institutionName: institutions.name,
      ownerTag: accounts.ownerTag,
      gmailLabelId: accounts.gmailLabelId,
    })
    .from(accounts)
    .leftJoin(institutions, eq(institutions.id, accounts.institutionId))
    .where(
      and(
        eq(accounts.householdId, session.householdId),
        eq(accounts.archived, false),
      ),
    )
    .orderBy(institutions.name, accounts.type, accounts.name);

  return (
    <div className="space-y-8">
      <header className="pt-2">
        <Label>Settings · Gmail</Label>
        <Display size="lg" className="mt-2 block">
          Import desde Gmail
        </Display>
        <Body className="mt-2 max-w-2xl">
          Configurá un label de Gmail por cada cuenta que recibe resúmenes por email.
          El cron pollea los labels cada 4 horas, descarga los PDFs adjuntos y los
          parsea automáticamente. Los mails procesados se mueven al label
          &quot;gd-procesados&quot;.
        </Body>
      </header>

      <GmailLabelConfig accounts={accountRows} />
    </div>
  );
}
