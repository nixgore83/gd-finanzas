import { NextResponse } from 'next/server';
import { and, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, households, householdMembers } from '@/db/schema';
import { getServerEnv } from '@/lib/env';
import {
  listMessagesInLabel,
  getAttachments,
  moveToProcessed,
  findOrCreateLabel,
  GmailConfigError,
} from '@/lib/gmail/client';
import { createImportInternal } from '@/lib/imports/create-internal';
import { parseImportInternal } from '@/lib/imports/parse-internal';
import { routeAttachment, type RoutableAccount } from '@/lib/gmail/attachment-router';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

function importTypeFromAccountType(type: string): 'tc' | 'banco' | 'broker' {
  if (type === 'credit_card') return 'tc';
  if (type === 'broker') return 'broker';
  return 'banco';
}

type WatchedAccount = {
  id: string;
  name: string;
  type: string;
  currencyDefault: string;
  institutionId: string | null;
  gmailLabelId: string | null;
  pdfPassword: string | null;
};

/** Group accounts by gmailLabelId so shared-label emails are processed once. */
function groupByLabel(accs: WatchedAccount[]): Map<string, WatchedAccount[]> {
  const map = new Map<string, WatchedAccount[]>();
  for (const acc of accs) {
    if (!acc.gmailLabelId) continue;
    const group = map.get(acc.gmailLabelId) ?? [];
    group.push(acc);
    map.set(acc.gmailLabelId, group);
  }
  return map;
}

export async function GET(request: Request) {
  const env = getServerEnv();

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // Check if Gmail OAuth is configured
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET || !env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    return NextResponse.json({ ok: true, skipped: 'gmail_not_configured' });
  }

  const db = getDb();

  // Get household (V1: single household)
  const [household] = await db.select({ id: households.id }).from(households).limit(1);
  if (!household) {
    return NextResponse.json({ ok: true, skipped: 'no_household' });
  }
  const householdId = household.id;

  // Get a userId for createdBy (first member of household)
  const [member] = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId))
    .limit(1);
  const userId = member?.userId ?? null;

  // Get accounts with Gmail label configured
  const watchedAccounts = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      currencyDefault: accounts.currencyDefault,
      institutionId: accounts.institutionId,
      gmailLabelId: accounts.gmailLabelId,
      pdfPassword: accounts.pdfPassword,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.householdId, householdId),
        eq(accounts.archived, false),
        isNotNull(accounts.gmailLabelId),
      ),
    );

  if (watchedAccounts.length === 0) {
    return NextResponse.json({ ok: true, skipped: 'no_gmail_accounts', accounts: 0 });
  }

  let processedLabelId: string;
  try {
    processedLabelId = await findOrCreateLabel('gd-procesados');
  } catch (err) {
    if (err instanceof GmailConfigError) {
      return NextResponse.json({ ok: true, skipped: 'gmail_not_configured' });
    }
    console.error('[cron/gmail-import] failed to get processed label', err);
    return NextResponse.json({ ok: false, error: 'label_setup_failed' }, { status: 502 });
  }

  const stats = { processed: 0, skipped: 0, errors: 0, accounts: watchedAccounts.length };
  const byLabel = groupByLabel(watchedAccounts);

  for (const [labelId, accountGroup] of byLabel) {
    try {
      const messageIds = await listMessagesInLabel(labelId);

      for (const msgId of messageIds) {
        try {
          const attachments = await getAttachments(msgId);

          if (attachments.length === 0) {
            await moveToProcessed(msgId, labelId, processedLabelId);
            stats.skipped++;
            continue;
          }

          let anyCreated = false;

          if (accountGroup.length === 1) {
            // ── Single-account label: existing behavior ──
            const acc = accountGroup[0]!;
            if (!acc.institutionId) continue;

            for (const att of attachments) {
              const result = await createAndParse(
                att.filename, att.data, acc, householdId, userId, stats,
              );
              if (result) anyCreated = true;
            }
          } else {
            // ── Multi-account label: route each attachment by content ──
            const routableAccounts: RoutableAccount[] = accountGroup
              .filter((a) => a.institutionId)
              .map((a) => ({
                id: a.id,
                name: a.name,
                type: a.type as RoutableAccount['type'],
                currencyDefault: a.currencyDefault as RoutableAccount['currencyDefault'],
                institutionId: a.institutionId,
                pdfPassword: a.pdfPassword,
              }));

            for (const att of attachments) {
              const isPdf = att.filename.toLowerCase().endsWith('.pdf');

              if (isPdf) {
                const routeResult = await routeAttachment(att.data, att.filename, routableAccounts);
                if (!routeResult) {
                  stats.skipped++;
                  continue;
                }

                const acc = accountGroup.find((a) => a.id === routeResult.account.id)!;
                const result = await createAndParse(
                  att.filename, routeResult.decryptedBytes, acc, householdId, userId, stats,
                );
                if (result) anyCreated = true;
              } else {
                // CSV: fall back to first account in group
                const acc = accountGroup[0]!;
                if (!acc.institutionId) continue;
                const result = await createAndParse(
                  att.filename, att.data, acc, householdId, userId, stats,
                );
                if (result) anyCreated = true;
              }
            }
          }

          if (anyCreated || attachments.length > 0) {
            await moveToProcessed(msgId, labelId, processedLabelId);
          }
        } catch {
          console.error('[cron/gmail-import] message processing failed', {
            messageId: msgId,
            labelId,
          });
          stats.errors++;
        }
      }
    } catch {
      console.error('[cron/gmail-import] label polling failed', { labelId });
      stats.errors++;
    }
  }

  console.warn('[cron/gmail-import] done', stats);
  return NextResponse.json({ ok: true, ...stats });
}

/** Create import + auto-parse. Returns true if an import was created. */
async function createAndParse(
  filename: string,
  bytes: Uint8Array,
  acc: WatchedAccount,
  householdId: string,
  userId: string | null,
  stats: { processed: number; skipped: number; errors: number },
): Promise<boolean> {
  if (!acc.institutionId) return false;

  const importType = importTypeFromAccountType(acc.type);
  const ext = filename.split('.').pop()?.toLowerCase() ?? 'pdf';
  const contentType = ext === 'csv' ? 'text/csv' : 'application/pdf';

  const createResult = await createImportInternal({
    householdId,
    userId: userId ?? '',
    file: { name: filename, bytes, contentType },
    type: importType,
    institutionId: acc.institutionId,
    accountId: acc.id,
  });

  if (!createResult.ok) {
    if (createResult.error === 'duplicate') {
      stats.skipped++;
    } else {
      console.error('[cron/gmail-import] create failed', {
        account: acc.name,
        file: filename,
        error: createResult.error,
      });
      stats.errors++;
    }
    return false;
  }

  const parseResult = await parseImportInternal(createResult.importId, householdId);
  if (!parseResult.ok) {
    console.error('[cron/gmail-import] parse failed', {
      importId: createResult.importId,
      error: parseResult.error,
    });
    stats.errors++;
  } else {
    stats.processed++;
  }

  return true;
}
