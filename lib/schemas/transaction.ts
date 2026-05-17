import { z } from 'zod';
import { positiveMoneySchema } from './money';
import { CURRENCIES } from './account';

/**
 * Schema de input para crear/editar una transacción manual.
 *
 * En Hito 3.A solo soportamos `income` y `expense`. Transferencias entran en
 * 3.C con su propia validación cross-cuenta.
 *
 * Convención: `amountOriginal` siempre positivo; el `kind` carga la dirección.
 */

export const TRANSACTION_KINDS = ['income', 'expense'] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const TRANSACTION_KIND_LABELS: Record<TransactionKind, string> = {
  income: 'Ingreso',
  expense: 'Gasto',
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const transactionInputSchema = z.object({
  date: z.string().regex(ISO_DATE_RE, { message: 'Fecha inválida (YYYY-MM-DD)' }),
  accountId: z.string().uuid({ message: 'Cuenta requerida' }),
  categoryId: z.string().uuid({ message: 'Categoría requerida' }),
  kind: z.enum(TRANSACTION_KINDS, { errorMap: () => ({ message: 'Tipo inválido' }) }),
  amountOriginal: positiveMoneySchema,
  currencyOriginal: z.enum(CURRENCIES, { errorMap: () => ({ message: 'Moneda inválida' }) }),
  description: z
    .string()
    .trim()
    .min(1, { message: 'Descripción requerida' })
    .max(200, { message: 'Máximo 200 caracteres' }),
  notes: z
    .string()
    .trim()
    .max(500, { message: 'Máximo 500 caracteres' })
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type TransactionInput = z.infer<typeof transactionInputSchema>;

export function parseTransactionFormData(formData: FormData) {
  const notesRaw = formData.get('notes');
  const notes = typeof notesRaw === 'string' && notesRaw.trim().length > 0 ? notesRaw : null;

  return transactionInputSchema.safeParse({
    date: formData.get('date'),
    accountId: formData.get('accountId'),
    categoryId: formData.get('categoryId'),
    kind: formData.get('kind'),
    amountOriginal: formData.get('amountOriginal'),
    currencyOriginal: formData.get('currencyOriginal'),
    description: formData.get('description'),
    notes,
  });
}
