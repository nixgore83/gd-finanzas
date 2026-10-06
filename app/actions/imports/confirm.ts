'use server';

import { revalidatePath } from 'next/cache';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import {
  confirmImportInternal,
  type ConfirmImportResult,
} from '@/lib/imports/confirm-internal';

export type { ConfirmImportResult };

/**
 * Confirma un import desde la UI: resuelve la sesión (MFA + household) y
 * delega en `confirmImportInternal`, que es donde vive toda la lógica de
 * creación de transacciones, pareo de transferencias y auto-match. Acá solo
 * queda lo que es propio de una request de Next: sesión y revalidación.
 */
export async function confirmImport(input: {
  importId: string;
  accountId: string;
}): Promise<ConfirmImportResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const result = await confirmImportInternal(input, session);

  if (result.ok) {
    revalidatePath(`/imports/${input.importId}`);
    revalidatePath('/imports');
    revalidatePath('/transactions');
    if (result.autoMatchCount > 0) {
      revalidatePath('/forecasts');
    }
  }

  return result;
}
