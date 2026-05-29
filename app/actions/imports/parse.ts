'use server';

import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { parseImportInternal, type ParseImportInternalResult } from '@/lib/imports/parse-internal';

export type ParseImportResult = ParseImportInternalResult | { ok: false; error: 'session' };

export async function parseImport(
  importId: string,
  customPassword?: string,
  persistPassword?: boolean,
): Promise<ParseImportResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  return parseImportInternal(importId, session.householdId, customPassword, persistPassword);
}
