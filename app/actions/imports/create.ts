'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { imports, institutions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import {
  contentTypeForExt,
  extractExtension,
  MAX_IMPORT_FILE_BYTES,
  parseImportCreateMeta,
} from '@/lib/schemas/import';
import {
  buildImportPath,
  hashBytes,
  uploadImportFile,
} from '@/lib/imports/storage';

export type CreateImportResult =
  | { ok: true; importId: string }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'session'
        | 'no_file'
        | 'file_too_large'
        | 'unsupported_format'
        | 'institution_not_found'
        | 'duplicate'
        | 'storage'
        | 'unknown';
      fields?: Record<string, string>;
      duplicate?: {
        importId: string;
        confirmedAt: string | null;
      };
    };

export async function createImport(formData: FormData): Promise<CreateImportResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const parsedMeta = parseImportCreateMeta(formData);
  if (!parsedMeta.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsedMeta.error.issues) {
      const key = String(issue.path[0] ?? '_');
      fields[key] ??= issue.message;
    }
    return { ok: false, error: 'invalid_input', fields };
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'no_file' };
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, error: 'file_too_large' };
  }

  const ext = extractExtension(file.name);
  if (!ext) return { ok: false, error: 'unsupported_format' };

  const db = getDb();

  const [inst] = await db
    .select({ id: institutions.id })
    .from(institutions)
    .where(eq(institutions.id, parsedMeta.data.institutionId))
    .limit(1);
  if (!inst) return { ok: false, error: 'institution_not_found' };

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const fileHash = await hashBytes(bytes);

  if (!parsedMeta.data.force) {
    const [dup] = await db
      .select({ id: imports.id, confirmedAt: imports.confirmedAt })
      .from(imports)
      .where(
        and(
          eq(imports.householdId, session.householdId),
          eq(imports.fileHash, fileHash),
          eq(imports.status, 'confirmed'),
        ),
      )
      .orderBy(desc(imports.confirmedAt))
      .limit(1);

    if (dup) {
      return {
        ok: false,
        error: 'duplicate',
        duplicate: {
          importId: dup.id,
          confirmedAt: dup.confirmedAt?.toISOString() ?? null,
        },
      };
    }
  }

  let importId: string;
  try {
    const [row] = await db
      .insert(imports)
      .values({
        householdId: session.householdId,
        fileUrl: '',
        fileHash,
        type: parsedMeta.data.type,
        institutionId: parsedMeta.data.institutionId,
        accountId: parsedMeta.data.accountId ?? null,
        parserModel: 'pending',
        status: 'uploaded',
        createdBy: session.userId,
      })
      .returning({ id: imports.id });
    if (!row) throw new Error('insert returned no row');
    importId = row.id;
  } catch (err) {
    console.error('[imports] insert failed', { code: (err as { code?: string }).code });
    return { ok: false, error: 'unknown' };
  }

  const path = buildImportPath(session.householdId, importId, ext);
  try {
    await uploadImportFile({
      bytes,
      contentType: contentTypeForExt(ext),
      path,
    });
  } catch {
    console.error('[imports] storage upload failed', { importId });
    // rollback row
    await db.delete(imports).where(eq(imports.id, importId));
    return { ok: false, error: 'storage' };
  }

  await db.update(imports).set({ fileUrl: path }).where(eq(imports.id, importId));

  revalidatePath('/imports');
  return { ok: true, importId };
}
