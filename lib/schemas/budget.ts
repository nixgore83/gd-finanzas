import { z } from 'zod';
import { moneySchema } from './money';

/**
 * Schema de input para set de un budget. PRD §5.5:
 * - granularidad: categoría × mes × año
 * - amount en USD (numeric(18,2))
 *
 * Permitimos amount=0 (set explícito a "presupuestar cero") y negativos
 * (raros pero el PRD no los prohíbe). Para borrar la fila, usar `clear`
 * separado.
 */

export const budgetInputSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  categoryId: z.string().uuid({ message: 'Categoría requerida' }),
  amountUsd: moneySchema,
});

export type BudgetInput = z.infer<typeof budgetInputSchema>;

export function parseSetBudgetFormData(formData: FormData) {
  return budgetInputSchema.safeParse({
    year: formData.get('year'),
    month: formData.get('month'),
    categoryId: formData.get('categoryId'),
    amountUsd: formData.get('amountUsd'),
  });
}

const clearSchema = budgetInputSchema.omit({ amountUsd: true });
export type ClearBudgetInput = z.infer<typeof clearSchema>;

export function parseClearBudgetFormData(formData: FormData) {
  return clearSchema.safeParse({
    year: formData.get('year'),
    month: formData.get('month'),
    categoryId: formData.get('categoryId'),
  });
}
