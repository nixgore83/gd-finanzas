import { z } from 'zod';
import Decimal from 'decimal.js';

/**
 * Canónica de dinero en el sistema: string con exactamente 2 decimales.
 * Coincide con la columna `numeric(18, 2)` de Postgres. Negativos OK
 * (reintegros, ajustes). Nunca usamos `number` para operar con dinero.
 */

export function toMoneyString(value: string | number | Decimal): string {
  const d = new Decimal(value);
  if (!d.isFinite()) {
    throw new Error('Money must be finite');
  }
  return d.toFixed(2, Decimal.ROUND_HALF_UP);
}

export function parseMoney(value: string): Decimal {
  return new Decimal(value);
}

export const moneySchema = z
  .union([z.string().trim().min(1, { message: 'Monto requerido' }), z.number()])
  .transform((v, ctx) => {
    try {
      const d = new Decimal(v);
      if (!d.isFinite()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Monto inválido' });
        return z.NEVER;
      }
      return d.toFixed(2, Decimal.ROUND_HALF_UP);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Monto inválido' });
      return z.NEVER;
    }
  });

export const positiveMoneySchema = moneySchema.refine((s) => !new Decimal(s).isNegative(), {
  message: 'El monto no puede ser negativo',
});
