import { NextResponse } from 'next/server';
import { and, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, households, householdMembers } from '@/db/schema';
import { getCronSecret, getGoogleEnv } from '@/lib/env';
import {
  listMessagesInLabel,
  getAttachments,
  moveToProcessed,
  findOrCreateLabel,
  GmailConfigError,
} from '@/lib/gmail/client';
import { createImportInternal } from '@/lib/imports/create-internal';
import { parseImportInternal } from '@/lib/imports/parse-internal';
import {
  routeAttachment,
  accountNumberSuffix,
  filenameSuffix,
  type RoutableAccount,
} from '@/lib/gmail/attachment-router';
import { decryptPdfPassword } from '@/lib/crypto/pdf-password';

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
  cardBrand: 'visa' | 'master' | 'amex' | null;
  currencyDefault: string;
  institutionId: string | null;
  gmailLabelId: string | null;
  accountNumber: string | null;
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
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${getCronSecret()}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // Check if Gmail OAuth is configured
  const google = getGoogleEnv();
  if (
    !google.GOOGLE_OAUTH_CLIENT_ID ||
    !google.GOOGLE_OAUTH_CLIENT_SECRET ||
    !google.GOOGLE_OAUTH_REFRESH_TOKEN
  ) {
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
      cardBrand: accounts.cardBrand,
      currencyDefault: accounts.currencyDefault,
      institutionId: accounts.institutionId,
      gmailLabelId: accounts.gmailLabelId,
      accountNumber: accounts.accountNumber,
      pdfPassword: accounts.pdfPassword,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.householdId, householdId),
        eq(accounts.archived, false),
        isNotNull(accounts.gmailLabelId),
      ),
    )
    // Orden determinístico: sin esto "la primera cuenta del grupo" (el fallback
    // de los adjuntos que no rutean) queda a criterio de Postgres.
    .orderBy(accounts.id);

  if (watchedAccounts.length === 0) {
    return NextResponse.json({ ok: true, skipped: 'no_gmail_accounts', accounts: 0 });
  }

  let processedLabelId: string;
  let unroutedLabelId: string;
  try {
    processedLabelId = await findOrCreateLabel('gd-procesados');
    // Los adjuntos que no se pudieron rutear NO van a gd-procesados: van acá,
    // donde quedan visibles. Antes se archivaban como si se hubieran importado
    // y el faltante era invisible.
    unroutedLabelId = await findOrCreateLabel('gd-sin-rutear');
  } catch (err) {
    if (err instanceof GmailConfigError) {
      return NextResponse.json({ ok: true, skipped: 'gmail_not_configured' });
    }
    console.error('[cron/gmail-import] failed to get processed label', err);
    return NextResponse.json({ ok: false, error: 'label_setup_failed' }, { status: 502 });
  }

  const stats = {
    processed: 0,
    skipped: 0,
    unrouted: 0,
    errors: 0,
    accounts: watchedAccounts.length,
  };
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

          let anyHandled = false;

          if (accountGroup.length === 1) {
            // ── Single-account label: existing behavior ──
            const acc = accountGroup[0]!;
            if (acc.institutionId) {
              for (const att of attachments) {
                const result = await createAndParse(
                  att.filename,
                  att.data,
                  acc,
                  householdId,
                  userId,
                  stats,
                );
                if (result) anyHandled = true;
              }
            }
          } else {
            // ── Multi-account label: route each attachment by content ──
            // `pdfPassword` viene CIFRADA de la DB → se descifra acá, en el punto
            // de uso. Si la clave maestra falta, seguimos sin contraseña (el PDF
            // puede no estar protegido) en vez de voltear todo el cron.
            const routableAccounts: RoutableAccount[] = accountGroup
              .filter((a) => a.institutionId)
              .map((a) => {
                let pdfPassword: string | null = null;
                try {
                  pdfPassword = decryptPdfPassword(a.pdfPassword);
                } catch {
                  console.error('[cron/gmail-import] pdf password decrypt failed', {
                    accountId: a.id,
                  });
                }
                return {
                  id: a.id,
                  name: a.name,
                  type: a.type as RoutableAccount['type'],
                  cardBrand: a.cardBrand,
                  currencyDefault: a.currencyDefault as RoutableAccount['currencyDefault'],
                  institutionId: a.institutionId,
                  accountNumber: a.accountNumber,
                  pdfPassword,
                };
              });

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
                  att.filename,
                  routeResult.bytes,
                  acc,
                  householdId,
                  userId,
                  stats,
                );
                if (result) anyHandled = true;
              } else {
                // CSV: se rutea por el sufijo del filename igual que los PDF. Sin
                // sufijo no adivinamos: mandar el CSV a "la primera cuenta del
                // grupo" metía movimientos en la cuenta equivocada.
                const suffix = filenameSuffix(att.filename);
                const acc = suffix
                  ? accountGroup.find((a) => accountNumberSuffix(a.accountNumber) === suffix)
                  : undefined;
                if (!acc?.institutionId) {
                  stats.skipped++;
                  continue;
                }
                const result = await createAndParse(
                  att.filename,
                  att.data,
                  acc,
                  householdId,
                  userId,
                  stats,
                );
                if (result) anyHandled = true;
              }
            }
          }

          // Solo se archiva como procesado lo que EFECTIVAMENTE generó un import.
          // Lo demás va a gd-sin-rutear: sale del label de entrada (no se
          // reintenta en loop) pero queda visible en vez de desaparecer.
          if (anyHandled) {
            await moveToProcessed(msgId, labelId, processedLabelId);
          } else {
            await moveToProcessed(msgId, labelId, unroutedLabelId);
            stats.unrouted++;
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

/**
 * Create import + auto-parse. Devuelve `true` si el adjunto quedó **atendido**:
 * se creó el import, o ya existía (duplicado). `false` solo si no se pudo crear.
 * Un duplicado cuenta como atendido a propósito: el mail ya dio su fruto y tiene
 * que archivarse en gd-procesados, no quedar marcado como sin rutear.
 */
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
    userId: userId,
    file: { name: filename, bytes, contentType },
    type: importType,
    institutionId: acc.institutionId,
    accountId: acc.id,
  });

  if (!createResult.ok) {
    if (createResult.error === 'duplicate') {
      stats.skipped++;
      return true;
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
