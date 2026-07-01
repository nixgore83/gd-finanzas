import { type ImportType } from '@/lib/schemas/import';

/** Los tres campos configurables por archivo antes de subir un import. */
export type UploadEntryConfig = {
  institutionId: string;
  type: ImportType;
  accountId: string;
};

/** Qué campos de la config bulk se propagan al aplicar "a todos". */
export type BulkApplyFlags = {
  institution: boolean;
  type: boolean;
  account: boolean;
};

/** Metadata mínima de cada cuenta para resolver institución/tipo al propagar. */
export type AccountMeta = Record<string, { institutionId: string; importType: ImportType }>;

/** Deriva el `ImportType` a partir del tipo de cuenta. */
export function importTypeFromAccountType(accountType: string): ImportType {
  if (accountType === 'credit_card') return 'tc';
  if (accountType === 'broker') return 'broker';
  return 'banco';
}

/** Forma mínima de cuenta para resolver la config inicial. */
export type AccountForInit = { id: string; institutionId: string | null; type: string };

/**
 * Config inicial del upload a partir de la preselección (link "Importar →" de
 * Resúmenes faltantes). Si vino una cuenta válida, manda su institución y tipo
 * (fuente de verdad); si no, se usa la institución dada o el fallback. Pura.
 */
export function resolveInitialUploadConfig(
  accounts: readonly AccountForInit[],
  opts: { initialAccountId?: string; initialInstitutionId?: string; fallbackInstitutionId: string },
): UploadEntryConfig {
  const acc = opts.initialAccountId
    ? accounts.find((a) => a.id === opts.initialAccountId)
    : undefined;
  if (acc) {
    return {
      institutionId: acc.institutionId ?? opts.fallbackInstitutionId,
      type: importTypeFromAccountType(acc.type),
      accountId: acc.id,
    };
  }
  return {
    institutionId: opts.initialInstitutionId || opts.fallbackInstitutionId,
    type: 'tc',
    accountId: '',
  };
}

/**
 * Aplica la config bulk a cada entrada según los campos tildados (`flags`),
 * preservando el resto de las props de cada entrada (id, file). Reglas de
 * coherencia:
 *  - Si se aplica Cuenta (no vacía), se fuerza también su institución y tipo:
 *    la cuenta es la fuente de verdad (aunque esos flags estén off).
 *  - Si se aplica Institución sin Cuenta y la cuenta actual de una entrada
 *    pertenece a otra institución, se resetea esa cuenta (evita cuenta huérfana
 *    de otra institución, mismo criterio que el select por-archivo).
 */
export function applyBulkToEntries<T extends UploadEntryConfig>(
  entries: readonly T[],
  bulk: UploadEntryConfig,
  flags: BulkApplyFlags,
  accountMeta: AccountMeta,
): T[] {
  return entries.map((entry) => {
    const patch: Partial<UploadEntryConfig> = {};

    if (flags.institution) patch.institutionId = bulk.institutionId;
    if (flags.type) patch.type = bulk.type;

    if (flags.account) {
      patch.accountId = bulk.accountId;
      const meta = bulk.accountId ? accountMeta[bulk.accountId] : undefined;
      if (meta) {
        // La cuenta implica su institución y su tipo.
        patch.institutionId = meta.institutionId;
        patch.type = meta.importType;
      }
    }

    // Institución cambia sin aplicar cuenta → resetear cuenta de otra institución.
    if (patch.institutionId !== undefined && !flags.account) {
      const accId = entry.accountId;
      if (accId && accountMeta[accId]?.institutionId !== patch.institutionId) {
        patch.accountId = '';
      }
    }

    return { ...entry, ...patch };
  });
}
