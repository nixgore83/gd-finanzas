import { z } from 'zod';
import Decimal from 'decimal.js';
import { positiveMoneySchema } from './money';

/**
 * Schema de input para crear/editar una transferencia entre 2 cuentas del
 * mismo household. Refleja la forma de la UI: 2 montos explícitos (from + to),
 * obligatorios. La UI auto-llena `amountTo = amountFrom` cuando ambas cuentas
 * son misma moneda; el server no lo inventa.
 *
 * Convención del par persistido (en `transactions`):
 *   - pata "out": amount_original NEGATIVO, account_id = from
 *   - pata "in" : amount_original POSITIVO, account_id = to
 *   - mismo `transfer_pair_id` en ambas filas
 *   - `kind = 'transfer'`, `category_id = null`
 *
 * Override de FX: mismo helper inline que `transaction.ts`. Si vacío, se
 * recompute con BCRA; si filled, source = 'manual_override'.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const baseTransferSchema = z.object({
  date: z.string().regex(ISO_DATE_RE, { message: 'Fecha inválida (YYYY-MM-DD)' }),
  accountFromId: z.string().uuid({ message: 'Cuenta origen requerida' }),
  accountToId: z.string().uuid({ message: 'Cuenta destino requerida' }),
  amountFrom: positiveMoneySchema,
  amountTo: positiveMoneySchema,
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
  fxRateOverride: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v, ctx) => {
      if (v === undefined || v === null) return null;
      const trimmed = v.trim();
      if (trimmed === '') return null;
      try {
        const d = new Decimal(trimmed);
        if (!d.isFinite() || d.lessThanOrEqualTo(0)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'FX inválido' });
          return z.NEVER;
        }
        return d.toFixed(6, Decimal.ROUND_HALF_UP);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'FX inválido' });
        return z.NEVER;
      }
    }),
});

export const transferInputSchema = baseTransferSchema.refine(
  (d) => d.accountFromId !== d.accountToId,
  { path: ['accountToId'], message: 'Las cuentas tienen que ser distintas' },
);

export type TransferInput = z.infer<typeof transferInputSchema>;

export function parseTransferFormData(formData: FormData) {
  const notesRaw = formData.get('notes');
  const notes = typeof notesRaw === 'string' && notesRaw.trim().length > 0 ? notesRaw : null;

  return transferInputSchema.safeParse({
    date: formData.get('date'),
    accountFromId: formData.get('accountFromId'),
    accountToId: formData.get('accountToId'),
    amountFrom: formData.get('amountFrom'),
    amountTo: formData.get('amountTo'),
    description: formData.get('description'),
    notes,
    fxRateOverride: formData.get('fxRateOverride'),
  });
}
