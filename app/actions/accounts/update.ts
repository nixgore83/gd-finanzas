'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { accounts } from '@/db/schema';
import { parseAccountFormData, parsePdfPasswordIntent } from '@/lib/schemas/account';
import { encryptPdfPassword } from '@/lib/crypto/pdf-password';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type UpdateAccountResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'invalid_id'
        | 'not_found'
        | 'session'
        | 'crypto_key_missing'
        | 'unknown';
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

  // Contraseña de PDF: campo write-only. El form no la recibe, así que un input
  // vacío NO borra la guardada — solo `clear` (acción explícita del usuario) la
  // borra. Cuando se setea, se persiste cifrada (AES-256-GCM).
  const pdfIntent = parsePdfPasswordIntent(formData);
  let pdfPasswordPatch: { pdfPassword: string | null } | Record<string, never> = {};
  if (pdfIntent.mode === 'clear') {
    pdfPasswordPatch = { pdfPassword: null };
  } else if (pdfIntent.mode === 'set') {
    try {
      pdfPasswordPatch = { pdfPassword: encryptPdfPassword(pdfIntent.value) };
    } catch {
      // Sin detalles del secreto en el log: solo la causa operativa.
      console.error('[accounts] update: PDF_PASSWORD_ENC_KEY ausente o inválida');
      return { ok: false, error: 'crypto_key_missing' };
    }
  }

  const db = getDb();
  try {
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
        ...pdfPasswordPatch,
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
