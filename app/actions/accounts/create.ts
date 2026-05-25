'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { accounts } from '@/db/schema';
import { parseAccountFormData } from '@/lib/schemas/account';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type CreateAccountResult =
  | { ok: true; id: string }
  | { ok: false; error: 'invalid_input' | 'session' | 'unknown'; fields?: Record<string, string> };

export async function createAccount(formData: FormData): Promise<CreateAccountResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const parsed = parseAccountFormData(formData);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '_');
      fields[key] ??= issue.message;
    }
    return { ok: false, error: 'invalid_input', fields };
  }

  const db = getDb();
  try {
    const pdfPasswordRaw = formData.get('pdfPassword');
    const pdfPassword =
      typeof pdfPasswordRaw === 'string' && pdfPasswordRaw.length > 0
        ? pdfPasswordRaw
        : null;

    const [inserted] = await db
      .insert(accounts)
      .values({
        householdId: session.householdId,
        name: parsed.data.name,
        type: parsed.data.type,
        currencyDefault: parsed.data.currencyDefault,
        institutionId: parsed.data.institutionId,
        ownerTag: parsed.data.ownerTag,
        expectsMonthlyImport: parsed.data.expectsMonthlyImport,
        pdfPassword,
      })
      .returning({ id: accounts.id });

    if (!inserted) return { ok: false, error: 'unknown' };

    revalidatePath('/accounts');
    return { ok: true, id: inserted.id };
  } catch (err) {
    console.error('[accounts] create failed', { code: (err as { code?: string }).code });
    return { ok: false, error: 'unknown' };
  }
}
