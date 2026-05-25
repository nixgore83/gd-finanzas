'use server';

import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { listUserLabels, GmailConfigError } from '@/lib/gmail/client';

export type ListLabelsResult =
  | { ok: true; labels: Array<{ id: string; name: string }> }
  | { ok: false; error: 'session' | 'not_configured' | 'unknown' };

export async function listGmailLabels(): Promise<ListLabelsResult> {
  try {
    await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  try {
    const labels = await listUserLabels();
    return { ok: true, labels };
  } catch (err) {
    if (err instanceof GmailConfigError) return { ok: false, error: 'not_configured' };
    console.error('[gmail] list-labels failed', err);
    return { ok: false, error: 'unknown' };
  }
}
