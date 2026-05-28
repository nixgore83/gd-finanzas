import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { imports } from '@/db/schema';
import { extractExtension, contentTypeForExt } from '@/lib/schemas/import';
import { buildImportPath, hashBytes, uploadImportFile } from '@/lib/imports/storage';

export type CreateImportInternalResult =
  | { ok: true; importId: string }
  | { ok: false; error: 'duplicate' | 'unsupported_format' | 'storage' | 'unknown' };

export interface CreateImportInternalInput {
  householdId: string;
  userId: string | null;
  file: { name: string; bytes: Uint8Array; contentType: string };
  type: 'tc' | 'banco' | 'broker';
  institutionId: string;
  accountId: string;
}

/**
 * Creates an import record + uploads file to storage.
 * Does NOT require a user session — designed for cron/server-side use.
 * Deduplicates by file hash against confirmed imports.
 */
export async function createImportInternal(
  input: CreateImportInternalInput,
): Promise<CreateImportInternalResult> {
  const ext = extractExtension(input.file.name);
  if (!ext) return { ok: false, error: 'unsupported_format' };

  const db = getDb();
  const fileHash = await hashBytes(input.file.bytes);

  // Dedup check
  const [dup] = await db
    .select({ id: imports.id })
    .from(imports)
    .where(
      and(
        eq(imports.householdId, input.householdId),
        eq(imports.fileHash, fileHash),
        eq(imports.status, 'confirmed'),
      ),
    )
    .orderBy(desc(imports.confirmedAt))
    .limit(1);

  if (dup) return { ok: false, error: 'duplicate' };

  let importId: string;
  try {
    const [row] = await db
      .insert(imports)
      .values({
        householdId: input.householdId,
        fileUrl: '',
        fileHash,
        fileName: input.file.name,
        type: input.type,
        institutionId: input.institutionId,
        accountId: input.accountId,
        parserModel: 'pending',
        status: 'uploaded',
        createdBy: input.userId || null,
      })
      .returning({ id: imports.id });
    if (!row) throw new Error('insert returned no row');
    importId = row.id;
  } catch (err) {
    console.error('[imports] create-internal insert failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }

  const path = buildImportPath(input.householdId, importId, ext);
  try {
    await uploadImportFile({
      bytes: input.file.bytes,
      contentType: contentTypeForExt(ext),
      path,
    });
  } catch {
    console.error('[imports] create-internal storage upload failed', { importId });
    await db.delete(imports).where(eq(imports.id, importId));
    return { ok: false, error: 'storage' };
  }

  await db.update(imports).set({ fileUrl: path }).where(eq(imports.id, importId));

  return { ok: true, importId };
}
