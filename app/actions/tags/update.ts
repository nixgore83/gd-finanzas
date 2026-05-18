'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { tags } from '@/db/schema';
import { parseTagFormData } from '@/lib/schemas/tag';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type UpdateTagResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: 'invalid_input' | 'invalid_id' | 'not_found' | 'name_taken' | 'session' | 'unknown';
      fields?: Record<string, string>;
    };

const idSchema = z.string().uuid();

export async function updateTag(formData: FormData): Promise<UpdateTagResult> {
  const idParsed = idSchema.safeParse(formData.get('id'));
  if (!idParsed.success) return { ok: false, error: 'invalid_id' };
  const id = idParsed.data;

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
    const result = await db
      .update(tags)
      .set({ name: parsed.data.name, color: parsed.data.color })
      .where(and(eq(tags.id, id), eq(tags.householdId, session.householdId)))
      .returning({ id: tags.id });

    if (result.length === 0) return { ok: false, error: 'not_found' };

    revalidatePath('/tags');
    revalidatePath(`/tags/${id}`);
    return { ok: true, id };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23505') {
      return {
        ok: false,
        error: 'name_taken',
        fields: { name: 'Ya existe una etiqueta con ese nombre' },
      };
    }
    console.error('[tags] update failed', { code });
    return { ok: false, error: 'unknown' };
  }
}
