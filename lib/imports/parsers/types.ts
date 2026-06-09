import { z } from 'zod';
import type { ImportType } from '@/lib/schemas/import';

/**
 * Identificadores de la contraparte de una transferencia/movimiento (ordenante o
 * beneficiario). Decisión 2026-06-08 (Nico): se PERSISTEN deliberadamente para
 * alinear info y deducible Ganancias — excepción documentada a la regla general
 * de no almacenar datos sensibles (ver CLAUDE.md §seguridad). Viven en
 * `import_lines.parsed_data.counterparty` y, al confirmar, en
 * `transactions.meta.counterparty`. Protegidos por RLS+MFA, nunca logueados.
 */
const counterpartySchema = z.object({
  name: z.string().max(200).optional(),
  accountRef: z.string().max(100).optional(),
  cuil: z.string().max(20).optional(),
  cbu: z.string().max(40).optional(),
  alias: z.string().max(100).optional(),
});

export type Counterparty = z.infer<typeof counterpartySchema>;

const parsedTxLineStrictSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha en formato YYYY-MM-DD'),
  description: z.string().min(1).max(500),
  amountOriginal: z.string().regex(/^-?\d+(\.\d+)?$/, 'monto numérico'),
  currencyOriginal: z.enum(['ARS', 'USD']),
  kind: z.enum(['income', 'expense']),
  merchant: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
  suggestedCategory: z.string().max(200).optional(),
  /** True if this line looks like a transfer between own accounts */
  isTransfer: z.boolean().optional().default(false),
  /** UUID of the counterpart account — set by user in review UI */
  transferAccountId: z.string().uuid().optional(),
  /** Identificadores de la contraparte (ordenante/beneficiario). Ver counterpartySchema. */
  counterparty: counterpartySchema.optional(),
});

/**
 * Schema con preprocess tolerante: mapea nombres alternativos comunes que el
 * LLM puede devolver (amount/monto/importe → amountOriginal,
 * currency/moneda → currencyOriginal, descripcion/detalle → description, etc.),
 * normaliza case y números, y deriva `kind` del signo del monto si viene
 * negativo.
 *
 * El objetivo es no romper el flujo cuando el modelo se desvía mínimamente del
 * shape pedido; los prompts siguen siendo explícitos pero esto es defensa
 * adicional.
 */
export const parsedTxLineSchema = z.preprocess((val) => {
  if (!val || typeof val !== 'object') return val;
  const obj = val as Record<string, unknown>;
  const out: Record<string, unknown> = { ...obj };

  // Alias → canonical
  if (out.amountOriginal == null) {
    out.amountOriginal =
      out.amount ?? out.monto ?? out.importe ?? out.amount_original ?? out.value;
  }
  if (out.currencyOriginal == null) {
    out.currencyOriginal =
      out.currency ?? out.moneda ?? out.currency_original ?? out.ccy;
  }
  if (out.description == null) {
    out.description =
      out.descripcion ?? out.descripción ?? out.detalle ?? out.concepto ?? out.concept;
  }
  if (out.date == null) {
    out.date = out.fecha ?? out.transaction_date ?? out.posting_date ?? out.trans_date;
  }
  if (out.kind == null) {
    out.kind = out.tipo ?? out.type;
  }

  // isTransfer aliases
  if (out.isTransfer == null) {
    out.isTransfer = out.is_transfer ?? out.transfer ?? out.esTransferencia;
  }
  // Coerce string "true"/"false" to boolean
  if (typeof out.isTransfer === 'string') {
    out.isTransfer = out.isTransfer.toLowerCase() === 'true';
  }

  // Number → string
  if (typeof out.amountOriginal === 'number') {
    out.amountOriginal = String(out.amountOriginal);
  }

  // Signo negativo → flip + asumir expense si no hay kind explícito
  if (typeof out.amountOriginal === 'string' && out.amountOriginal.startsWith('-')) {
    out.amountOriginal = out.amountOriginal.slice(1);
    if (out.kind == null) out.kind = 'expense';
  }

  // Quitar separadores de miles "1,234.56" → "1234.56" si parece formato US
  if (
    typeof out.amountOriginal === 'string' &&
    /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(out.amountOriginal)
  ) {
    out.amountOriginal = out.amountOriginal.replace(/,/g, '');
  }

  // currency upper-case
  if (typeof out.currencyOriginal === 'string') {
    out.currencyOriginal = out.currencyOriginal.toUpperCase();
  }

  // kind: español/sinónimos → income|expense
  if (typeof out.kind === 'string') {
    const k = out.kind.toLowerCase();
    if (
      k === 'gasto' ||
      k === 'consumo' ||
      k === 'debito' ||
      k === 'débito' ||
      k === 'cargo' ||
      k === 'compra'
    ) {
      out.kind = 'expense';
    } else if (
      k === 'ingreso' ||
      k === 'credito' ||
      k === 'crédito' ||
      k === 'pago' ||
      k === 'devolucion' ||
      k === 'devolución' ||
      k === 'reintegro'
    ) {
      out.kind = 'income';
    }
  }

  // counterparty: normalizar nombres alternativos comunes y descartar vacíos.
  if (out.counterparty && typeof out.counterparty === 'object') {
    const cp = out.counterparty as Record<string, unknown>;
    const norm: Record<string, unknown> = {
      name: cp.name ?? cp.nombre ?? cp.ordenante ?? cp.beneficiario ?? cp.titular,
      accountRef: cp.accountRef ?? cp.account_ref ?? cp.cuenta ?? cp.nroCuenta ?? cp.account_number ?? cp.accountNumber,
      cuil: cp.cuil ?? cp.cuit ?? cp.cuilCuit ?? cp.cuil_cuit,
      cbu: cp.cbu,
      alias: cp.alias,
    };
    // Quitar campos undefined/vacíos; si no queda nada, omitir counterparty.
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(norm)) {
      if (typeof v === 'string' && v.trim() !== '') cleaned[k] = v.trim();
    }
    out.counterparty = Object.keys(cleaned).length > 0 ? cleaned : undefined;
  }

  return out;
}, parsedTxLineStrictSchema);

export type ParsedTxLine = z.infer<typeof parsedTxLineStrictSchema>;

const summarySchema = z.preprocess((val) => {
  if (!val || typeof val !== 'object') return val;
  const obj = val as Record<string, unknown>;
  const out: Record<string, unknown> = { ...obj };
  // Alias handling
  if (out.totalExpense == null) {
    out.totalExpense = out.total_expense ?? out.totalGastos ?? out.total_gastos ?? out.totalCharges;
  }
  if (out.totalIncome == null) {
    out.totalIncome = out.total_income ?? out.totalPagos ?? out.total_pagos ?? out.totalPayments ?? out.totalCredits;
  }
  if (out.currency == null) {
    out.currency = out.moneda ?? out.currencyOriginal;
  }
  // Number → string
  if (typeof out.totalExpense === 'number') out.totalExpense = String(out.totalExpense);
  if (typeof out.totalIncome === 'number') out.totalIncome = String(out.totalIncome);
  // Uppercase currency
  if (typeof out.currency === 'string') out.currency = out.currency.toUpperCase();
  return out;
}, z.object({
  totalExpense: z.string().optional(),
  totalIncome: z.string().optional(),
  currency: z.enum(['ARS', 'USD']).optional(),
}));

/**
 * Cuenta PROPIA del extracto (la del encabezado del PDF, no la contraparte).
 * Su `number` se usa para auto-sugerir la cuenta destino del import.
 */
const statementAccountSchema = z.preprocess((val) => {
  if (!val || typeof val !== 'object') return val;
  const obj = val as Record<string, unknown>;
  const number = obj.number ?? obj.nroCuenta ?? obj.account_number ?? obj.accountNumber ?? obj.cuenta;
  const holder = obj.holder ?? obj.titular ?? obj.nombre ?? obj.name;
  const out: Record<string, unknown> = {};
  if (typeof number === 'string' && number.trim() !== '') out.number = number.trim();
  if (typeof holder === 'string' && holder.trim() !== '') out.holder = holder.trim();
  return Object.keys(out).length > 0 ? out : undefined;
}, z
  .object({
    number: z.string().max(100).optional(),
    holder: z.string().max(200).optional(),
  })
  .optional());

export const parserOutputSchema = z.object({
  lines: z.array(parsedTxLineSchema),
  summary: summarySchema.optional(),
  /** Cuenta propia del extracto (encabezado). Ver statementAccountSchema. */
  statementAccount: statementAccountSchema,
});

export type ImportSummary = {
  totalExpense?: string;
  totalIncome?: string;
  currency?: string;
};

export type ParserOutput = {
  lines: ParsedTxLine[];
  summary?: ImportSummary;
  statementAccount?: { number?: string; holder?: string };
};

export type Parser = {
  id: string;
  institutionMatch: (institutionName: string) => boolean;
  importTypeMatch: (type: ImportType) => boolean;
  /** Optional — disambiguates when multiple parsers match the same institution+type */
  accountMatch?: (accountName: string) => boolean;
  systemPrompt: string;
  userPrompt: string;
  schema: typeof parserOutputSchema;
};
