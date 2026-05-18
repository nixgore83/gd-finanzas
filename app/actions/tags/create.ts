'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { tags } from '@/db/schema';
import { parseTagFormData } from '@/lib/schemas/tag';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type CreateTagResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: 'invalid_input' | 'name_taken' | 'session' | 'unknown';
      fields?: Record<string, string>;
    };

export async function createTag(formData: FormData): Promise<CreateTagResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const parsed = parseTagFormData(formData);
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
    const [inserted] = await db
      .insert(tags)
      .values({
        householdId: session.householdId,
        name: parsed.data.name,
        color: parsed.data.color,
      })
      .returning({ id: tags.id });

    if (!inserted) return { ok: false, error: 'unknown' };

    revalidatePath('/tags');
    return { ok: true, id: inserted.id };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23505') {
      return {
        ok: false,
        error: 'name_taken',
        fields: { name: 'Ya existe una etiqueta con ese nombre' },
      };
    }
    console.error('[tags] create failed', { code });
    return { ok: false, error: 'unknown' };
  }
}
