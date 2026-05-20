import { z } from 'zod';
import Decimal from 'decimal.js';
import { positiveMoneySchema } from './money';
import { CURRENCIES } from './account';
import { tagIdsSchema } from './tag';

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

/**
 * Para display en la lista. Incluye 'transfer' aunque el schema de input no
 * lo acepte — las transferencias se crean por `transferInputSchema`.
 */
export const ALL_KIND_LABELS: Record<'income' | 'expense' | 'transfer', string> = {
  income: 'Ingreso',
  expense: 'Gasto',
  transfer: 'Transferencia',
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIODO_RE = /^\d{4}-\d{2}$/;
const CUIL_RE = /^\d{2}-\d{8}-\d{1}$/;

export const TRANSACTION_SUBTYPES = ['standard', 'domestic_service'] as const;
export type TransactionSubtype = (typeof TRANSACTION_SUBTYPES)[number];

export const TRANSACTION_SUBTYPE_LABELS: Record<TransactionSubtype, string> = {
  standard: 'Estándar',
  domestic_service: 'Servicio doméstico',
};

export const DOMESTIC_SERVICE_CONCEPTOS = ['sueldo', 'aporte', 'aguinaldo'] as const;
export type DomesticServiceConcepto = (typeof DOMESTIC_SERVICE_CONCEPTOS)[number];

export const domesticServiceMetaSchema = z.object({
  empleado_nombre: z
    .string()
    .trim()
    .min(1, { message: 'Empleado requerido' })
    .max(120),
  empleado_cuil: z
    .string()
    .trim()
    .regex(CUIL_RE, { message: 'CUIL inválido (formato ##-########-#)' }),
  concepto: z.enum(DOMESTIC_SERVICE_CONCEPTOS, {
    errorMap: () => ({ message: 'Concepto inválido' }),
  }),
  periodo: z
    .string()
    .regex(PERIODO_RE, { message: 'Período inválido (YYYY-MM)' }),
});

export type DomesticServiceMeta = z.infer<typeof domesticServiceMetaSchema>;

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
  tagIds: tagIdsSchema.default([]),
  transactionSubtype: z
    .enum(TRANSACTION_SUBTYPES, { errorMap: () => ({ message: 'Subtipo inválido' }) })
    .default('standard'),
  deducibleGanancias: z.boolean().default(false),
  meta: z
    .union([domesticServiceMetaSchema, z.null()])
    .default(null),
}).superRefine((val, ctx) => {
  if (val.transactionSubtype === 'domestic_service') {
    if (!val.meta) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meta'],
        message: 'Servicio doméstico requiere datos del empleado',
      });
    }
    if (val.kind !== 'expense') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['transactionSubtype'],
        message: 'Servicio doméstico solo aplica a gastos',
      });
    }
  }
});

export type TransactionInput = z.infer<typeof transactionInputSchema>;

export function parseTransactionFormData(formData: FormData) {
  const notesRaw = formData.get('notes');
  const notes = typeof notesRaw === 'string' && notesRaw.trim().length > 0 ? notesRaw : null;

  const subtypeRaw = formData.get('transactionSubtype');
  const transactionSubtype =
    typeof subtypeRaw === 'string' && (TRANSACTION_SUBTYPES as readonly string[]).includes(subtypeRaw)
      ? subtypeRaw
      : 'standard';

  const deducible = formData.get('deducibleGanancias');
  const deducibleGanancias = deducible === 'on' || deducible === 'true' || deducible === '1';

  let meta: unknown = null;
  if (transactionSubtype === 'domestic_service') {
    meta = {
      empleado_nombre: formData.get('meta_empleado_nombre'),
      empleado_cuil: formData.get('meta_empleado_cuil'),
      concepto: formData.get('meta_concepto'),
      periodo: formData.get('meta_periodo'),
    };
  }

  return transactionInputSchema.safeParse({
    date: formData.get('date'),
    accountId: formData.get('accountId'),
    categoryId: formData.get('categoryId'),
    kind: formData.get('kind'),
    amountOriginal: formData.get('amountOriginal'),
    currencyOriginal: formData.get('currencyOriginal'),
    description: formData.get('description'),
    notes,
    fxRateOverride: formData.get('fxRateOverride'),
    tagIds: formData.getAll('tagIds').filter((v): v is string => typeof v === 'string'),
    transactionSubtype,
    deducibleGanancias,
    meta,
  });
}
