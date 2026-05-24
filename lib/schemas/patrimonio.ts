import { z } from 'zod';
import { moneySchema } from './money';
import Decimal from 'decimal.js';

const currencyValues = ['ARS', 'USD'] as const;
const assetTypeValues = ['stock', 'etf', 'bond', 'cedear', 'fci', 'crypto', 'other'] as const;

export const accountBalanceInputSchema = z.object({
  accountId: z.string().uuid(),
  balance: moneySchema,
  currency: z.enum(currencyValues),
  fxRateUsed: z
    .union([z.string().trim().min(1), z.number()])
    .optional()
    .nullable()
    .transform((v) => {
      if (v === null || v === undefined || v === '') return null;
      return new Decimal(v).toFixed(6);
    }),
  fxRateSource: z.string().optional().nullable(),
});

export type AccountBalanceInput = z.infer<typeof accountBalanceInputSchema>;

/**
 * Quantity y price usan 6 decimales (acciones fraccionarias, precios precisos).
 */
const quantitySchema = z
  .union([z.string().trim().min(1, { message: 'Cantidad requerida' }), z.number()])
  .transform((v, ctx) => {
    try {
      const d = new Decimal(v);
      if (!d.isFinite() || d.isNegative() || d.isZero()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Cantidad debe ser positiva' });
        return z.NEVER;
      }
      return d.toFixed(6);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Cantidad inválida' });
      return z.NEVER;
    }
  });

const priceSchema = z
  .union([z.string().trim().min(1, { message: 'Precio requerido' }), z.number()])
  .transform((v, ctx) => {
    try {
      const d = new Decimal(v);
      if (!d.isFinite() || d.isNegative()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Precio inválido' });
        return z.NEVER;
      }
      return d.toFixed(6);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Precio inválido' });
      return z.NEVER;
    }
  });

export const holdingInputSchema = z.object({
  accountId: z.string().uuid(),
  ticker: z.string().trim().min(1, { message: 'Ticker requerido' }).max(20),
  name: z.string().trim().min(1, { message: 'Nombre requerido' }).max(100),
  assetType: z.enum(assetTypeValues),
  quantity: quantitySchema,
  pricePerUnit: priceSchema,
  currency: z.enum(currencyValues),
  fxRateUsed: z
    .union([z.string().trim().min(1), z.number()])
    .optional()
    .nullable()
    .transform((v) => {
      if (v === null || v === undefined || v === '') return null;
      return new Decimal(v).toFixed(6);
    }),
  fxRateSource: z.string().optional().nullable(),
});

export type HoldingInput = z.infer<typeof holdingInputSchema>;

export const snapshotFormSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Fecha inválida (YYYY-MM-DD)' }),
  balances: z.array(accountBalanceInputSchema),
  holdings: z.array(holdingInputSchema),
  notes: z
    .string()
    .trim()
    .max(2000, { message: 'Máximo 2000 caracteres' })
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type SnapshotFormInput = z.infer<typeof snapshotFormSchema>;
