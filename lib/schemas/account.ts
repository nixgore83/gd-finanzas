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

const baseAccountSchema = z.object({
  name: z.string().trim().min(1, { message: 'Nombre requerido' }).max(80),
  type: z.enum(ACCOUNT_TYPES, { errorMap: () => ({ message: 'Tipo inválido' }) }),
  currencyDefault: z.enum(CURRENCIES, { errorMap: () => ({ message: 'Moneda inválida' }) }),
  institutionId: z.string().uuid().nullable(),
  ownerTag: z.enum(OWNER_TAGS, { errorMap: () => ({ message: 'Owner inválido' }) }),
  expectsMonthlyImport: z.coerce.boolean().default(false),
});

/**
 * Si `type` no es `cash`, debe tener `institutionId`. Cash no necesita
 * institución (efectivo en el bolsillo no pertenece a un banco).
 */
function refineInstitutionRequired<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((data, ctx) => {
    const obj = data as z.infer<typeof baseAccountSchema>;
    if (obj.type !== 'cash' && obj.institutionId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['institutionId'],
        message: 'Institución requerida para este tipo de cuenta',
      });
    }
  });
}

export const accountInputSchema = refineInstitutionRequired(baseAccountSchema);

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

  return accountInputSchema.safeParse({
    name: formData.get('name'),
    type: formData.get('type'),
    currencyDefault: formData.get('currencyDefault'),
    institutionId,
    ownerTag: formData.get('ownerTag'),
    expectsMonthlyImport: formData.get('expectsMonthlyImport') === 'on',
  });
}
