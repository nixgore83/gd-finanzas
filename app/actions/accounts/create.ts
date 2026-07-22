'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { accounts } from '@/db/schema';
import { parseAccountFormData, parsePdfPasswordIntent } from '@/lib/schemas/account';
import { encryptPdfPassword } from '@/lib/crypto/pdf-password';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type CreateAccountResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: 'invalid_input' | 'session' | 'crypto_key_missing' | 'unknown';
      fields?: Record<string, string>;
    };

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

  // Contraseña de PDF: se persiste SIEMPRE cifrada (AES-256-GCM). Sin la clave
  // maestra, la creación falla explícita en vez de guardar el secreto en claro.
  const pdfIntent = parsePdfPasswordIntent(formData);
  let pdfPassword: string | null = null;
  if (pdfIntent.mode === 'set') {
    try {
      pdfPassword = encryptPdfPassword(pdfIntent.value);
    } catch {
      // Sin detalles del secreto en el log: solo la causa operativa.
      console.error('[accounts] create: PDF_PASSWORD_ENC_KEY ausente o inválida');
      return { ok: false, error: 'crypto_key_missing' };
    }
  }

  const db = getDb();
  try {
    const [inserted] = await db
      .insert(accounts)
      .values({
        householdId: session.householdId,
        name: parsed.data.name,
        type: parsed.data.type,
        cardBrand: parsed.data.cardBrand,
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
