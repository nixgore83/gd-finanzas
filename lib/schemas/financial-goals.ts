import { z } from 'zod';
import { positiveMoneySchema } from './money';

/**
 * Schema de input para `financial_goals` (1 fila por household, UPSERT por
 * UNIQUE(household_id)). PRD §5.9.
 *
 * Montos siempre positivos (no negative wealth target). Edades 18-120
 * (sanity bounds; el plan se hace desde edad adulta y se mira a futuro).
 * Notas opcional, hasta 2000 chars.
 */

export const financialGoalsInputSchema = z.object({
  targetAhorroMensualUsd: positiveMoneySchema,
  edadTargetIfNico: z.coerce
    .number()
    .int({ message: 'Edad inválida' })
    .min(18, { message: 'Edad mínima 18' })
    .max(120, { message: 'Edad máxima 120' }),
  edadTargetIfPau: z.coerce
    .number()
    .int({ message: 'Edad inválida' })
    .min(18, { message: 'Edad mínima 18' })
    .max(120, { message: 'Edad máxima 120' }),
  numeroRetiroUsd: positiveMoneySchema,
  numeroEducacionUsd: positiveMoneySchema,
  bufferUsd: positiveMoneySchema,
  notas: z
    .string()
    .trim()
    .max(2000, { message: 'Máximo 2000 caracteres' })
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type FinancialGoalsInput = z.infer<typeof financialGoalsInputSchema>;

export function parseFinancialGoalsFormData(formData: FormData) {
  return financialGoalsInputSchema.safeParse({
    targetAhorroMensualUsd: formData.get('targetAhorroMensualUsd'),
    edadTargetIfNico: formData.get('edadTargetIfNico'),
    edadTargetIfPau: formData.get('edadTargetIfPau'),
    numeroRetiroUsd: formData.get('numeroRetiroUsd'),
    numeroEducacionUsd: formData.get('numeroEducacionUsd'),
    bufferUsd: formData.get('bufferUsd'),
    notas: formData.get('notas'),
  });
}
