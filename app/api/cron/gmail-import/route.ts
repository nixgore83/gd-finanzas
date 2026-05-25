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

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

function importTypeFromAccountType(type: string): 'tc' | 'banco' | 'broker' {
  if (type === 'credit_card') return 'tc';
  if (type === 'broker') return 'broker';
  return 'banco';
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
      institutionId: accounts.institutionId,
      gmailLabelId: accounts.gmailLabelId,
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

  for (const acc of watchedAccounts) {
    if (!acc.gmailLabelId || !acc.institutionId) continue;

    try {
      const messageIds = await listMessagesInLabel(acc.gmailLabelId);

      for (const msgId of messageIds) {
        try {
          const attachments = await getAttachments(msgId);

          if (attachments.length === 0) {
            // No PDF/CSV attachments — move to processed anyway
            await moveToProcessed(msgId, acc.gmailLabelId, processedLabelId);
            stats.skipped++;
            continue;
          }

          let anyCreated = false;

          for (const att of attachments) {
            const importType = importTypeFromAccountType(acc.type);

            const createResult = await createImportInternal({
              householdId,
              userId: userId ?? '',
              file: { name: att.filename, bytes: att.data, contentType: att.mimeType },
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
                  file: att.filename,
                  error: createResult.error,
                });
                stats.errors++;
              }
              continue;
            }

            // Auto-parse
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

            anyCreated = true;
          }

          // Move message to processed (whether we created imports or not)
          if (anyCreated || attachments.length > 0) {
            await moveToProcessed(msgId, acc.gmailLabelId, processedLabelId);
          }
        } catch {
          console.error('[cron/gmail-import] message processing failed', {
            messageId: msgId,
            account: acc.name,
          });
          stats.errors++;
        }
      }
    } catch {
      console.error('[cron/gmail-import] label polling failed', {
        account: acc.name,
        labelId: acc.gmailLabelId,
      });
      stats.errors++;
    }
  }

  console.warn('[cron/gmail-import] done', stats);
  return NextResponse.json({ ok: true, ...stats });
}
