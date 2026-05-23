import { z } from 'zod';

export const IMPORT_TYPES = ['tc', 'banco', 'broker'] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

export const IMPORT_TYPE_LABELS: Record<ImportType, string> = {
  tc: 'Tarjeta de crédito',
  banco: 'Banco',
  broker: 'Broker',
};

export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXTS = ['pdf', 'csv'] as const;

export const importCreateMetaSchema = z.object({
  type: z.enum(IMPORT_TYPES),
  institutionId: z.string().uuid(),
  accountId: z.string().uuid().optional(),
  force: z.boolean().optional(),
});

export function parseImportCreateMeta(formData: FormData) {
  const accountIdVal = formData.get('accountId');
  const raw = {
    type: formData.get('type'),
    institutionId: formData.get('institutionId'),
    accountId: accountIdVal && accountIdVal !== '' ? accountIdVal : undefined,
    force: formData.get('force') === '1',
  };
  return importCreateMetaSchema.safeParse(raw);
}

export function extractExtension(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return (ALLOWED_EXTS as readonly string[]).includes(ext) ? ext : null;
}

export function contentTypeForExt(ext: string): string {
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'csv') return 'text/csv';
  return 'application/octet-stream';
}
