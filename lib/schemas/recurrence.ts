import { z } from 'zod';
import { positiveMoneySchema } from './money';
import { CURRENCIES } from './account';

/**
 * Schema de input para una recurrencia. En V1 NO exponemos `custom` del enum
 * DB (queda muerto hasta V2 que necesite intervalos arbitrarios).
 */

export const RECURRENCE_FREQUENCIES = ['monthly', 'bimonthly', 'quarterly', 'yearly'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export const RECURRENCE_FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  monthly: 'Mensual',
  bimonthly: 'Bimestral',
  quarterly: 'Trimestral',
  yearly: 'Anual',
};

export const RECURRENCE_KINDS = ['income', 'expense'] as const;
export type RecurrenceKind = (typeof RECURRENCE_KINDS)[number];

export const RECURRENCE_KIND_LABELS: Record<RecurrenceKind, string> = {
  income: 'Ingreso',
  expense: 'Gasto',
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const recurrenceInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: 'Nombre requerido' })
      .max(80, { message: 'Máximo 80 caracteres' }),
    accountId: z.string().uuid({ message: 'Cuenta requerida' }),
    categoryId: z.string().uuid({ message: 'Categoría requerida' }),
    kind: z.enum(RECURRENCE_KINDS, { errorMap: () => ({ message: 'Tipo inválido' }) }),
    amount: positiveMoneySchema,
    currency: z.enum(CURRENCIES, { errorMap: () => ({ message: 'Moneda inválida' }) }),
    frequency: z.enum(RECURRENCE_FREQUENCIES, {
      errorMap: () => ({ message: 'Frecuencia inválida' }),
    }),
    dayOfMonth: z.coerce
      .number()
      .int({ message: 'Día inválido' })
      .min(1, { message: 'Día entre 1 y 31' })
      .max(31, { message: 'Día entre 1 y 31' }),
    startDate: z
      .string()
      .regex(ISO_DATE_RE, { message: 'Fecha inválida (YYYY-MM-DD)' }),
    endDate: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => (typeof v === 'string' && ISO_DATE_RE.test(v) ? v : null)),
    active: z.coerce.boolean().default(true),
  })
  .refine((d) => d.endDate === null || d.endDate >= d.startDate, {
    path: ['endDate'],
    message: 'La fecha de fin debe ser >= la de inicio',
  });

export type RecurrenceInput = z.infer<typeof recurrenceInputSchema>;

export function parseRecurrenceFormData(formData: FormData) {
  return recurrenceInputSchema.safeParse({
    name: formData.get('name'),
    accountId: formData.get('accountId'),
    categoryId: formData.get('categoryId'),
    kind: formData.get('kind'),
    amount: formData.get('amount'),
    currency: formData.get('currency'),
    frequency: formData.get('frequency'),
    dayOfMonth: formData.get('dayOfMonth'),
    startDate: formData.get('startDate'),
    endDate: formData.get('endDate'),
    active: formData.get('active') === 'true' || formData.get('active') === 'on',
  });
}
