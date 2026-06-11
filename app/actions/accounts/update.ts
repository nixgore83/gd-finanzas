'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { accounts } from '@/db/schema';
import { parseAccountFormData } from '@/lib/schemas/account';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type UpdateAccountResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: 'invalid_input' | 'invalid_id' | 'not_found' | 'session' | 'unknown';
      fields?: Record<string, string>;
    };

const idSchema = z.string().uuid();

export async function updateAccount(formData: FormData): Promise<UpdateAccountResult> {
  const idRaw = formData.get('id');
  const idParsed = idSchema.safeParse(idRaw);
  if (!idParsed.success) return { ok: false, error: 'invalid_id' };
  const id = idParsed.data;

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

    const result = await db
      .update(accounts)
      .set({
        name: parsed.data.name,
        type: parsed.data.type,
        cardBrand: parsed.data.cardBrand,
        currencyDefault: parsed.data.currencyDefault,
        institutionId: parsed.data.institutionId,
        ownerTag: parsed.data.ownerTag,
        expectsMonthlyImport: parsed.data.expectsMonthlyImport,
        pdfPassword,
      })
      .where(and(eq(accounts.id, id), eq(accounts.householdId, session.householdId)))
      .returning({ id: accounts.id });

    if (result.length === 0) return { ok: false, error: 'not_found' };

    revalidatePath('/accounts');
    revalidatePath(`/accounts/${id}`);
    return { ok: true, id };
  } catch (err) {
    console.error('[accounts] update failed', { code: (err as { code?: string }).code });
    return { ok: false, error: 'unknown' };
  }
}
