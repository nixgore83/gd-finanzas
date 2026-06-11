import { z } from 'zod';

export const ACCOUNT_TYPES = [
  'bank_checking',
  'bank_savings',
  'credit_card',
  'cash',
  'broker',
  'ewallet',
  'other',
] as const;

export const ACCOUNT_TYPE_LABELS: Record<(typeof ACCOUNT_TYPES)[number], string> = {
  bank_checking: 'Cuenta corriente',
  bank_savings: 'Caja de ahorro',
  credit_card: 'Tarjeta de crédito',
  cash: 'Efectivo',
  broker: 'Broker',
  ewallet: 'Billetera virtual',
  other: 'Otro',
};

export const CURRENCIES = ['ARS', 'USD'] as const;

export const OWNER_TAGS = ['Nico', 'Pau', 'Hogar'] as const;

export const CARD_BRANDS = ['visa', 'master', 'amex'] as const;

export const CARD_BRAND_LABELS: Record<(typeof CARD_BRANDS)[number], string> = {
  visa: 'Visa',
  master: 'Master',
  amex: 'Amex',
};

const baseAccountSchema = z.object({
  // "Rótulo" distintivo, opcional. El nombre legible se compone con
  // `formatAccount()` a partir de institución/tipo/marca/dueño/moneda; este
  // campo solo agrega una distinción que ningún otro campo captura.
  name: z.string().trim().max(80).default(''),
  type: z.enum(ACCOUNT_TYPES, { errorMap: () => ({ message: 'Tipo inválido' }) }),
  cardBrand: z.enum(CARD_BRANDS).nullable().default(null),
  currencyDefault: z.enum(CURRENCIES, { errorMap: () => ({ message: 'Moneda inválida' }) }),
  institutionId: z.string().uuid().nullable(),
  ownerTag: z.enum(OWNER_TAGS, { errorMap: () => ({ message: 'Owner inválido' }) }),
  expectsMonthlyImport: z.coerce.boolean().default(false),
});

/**
 * Reglas cruzadas:
 * - Si `type` no es `cash`, debe tener `institutionId` (efectivo en el bolsillo
 *   no pertenece a un banco).
 * - `cardBrand` (marca de tarjeta) solo aplica a `credit_card`; en cualquier
 *   otro tipo debe ser null.
 */
function refineAccount<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((data, ctx) => {
    const obj = data as z.infer<typeof baseAccountSchema>;
    if (obj.type !== 'cash' && obj.institutionId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['institutionId'],
        message: 'Institución requerida para este tipo de cuenta',
      });
    }
    if (obj.cardBrand !== null && obj.type !== 'credit_card') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cardBrand'],
        message: 'La marca solo aplica a tarjetas de crédito',
      });
    }
  });
}

export const accountInputSchema = refineAccount(baseAccountSchema);

export type AccountInput = z.infer<typeof accountInputSchema>;

/**
 * Pasa de un FormData de la UI al input parseado. Centraliza las coerciones
 * (institutionId vacío → null, owner_tag string → enum) así no se repite en
 * cada server action.
 */
export function parseAccountFormData(formData: FormData) {
  const institutionRaw = formData.get('institutionId');
  const institutionId =
    typeof institutionRaw === 'string' && institutionRaw.length > 0 ? institutionRaw : null;

  const cardBrandRaw = formData.get('cardBrand');
  const cardBrand =
    typeof cardBrandRaw === 'string' && cardBrandRaw.length > 0 ? cardBrandRaw : null;

  return accountInputSchema.safeParse({
    name: formData.get('name') ?? '',
    type: formData.get('type'),
    cardBrand,
    currencyDefault: formData.get('currencyDefault'),
    institutionId,
    ownerTag: formData.get('ownerTag'),
    expectsMonthlyImport: formData.get('expectsMonthlyImport') === 'on',
  });
}
