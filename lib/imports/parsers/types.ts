import { z } from 'zod';
import type { ImportType } from '@/lib/schemas/import';

const parsedTxLineStrictSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha en formato YYYY-MM-DD'),
  description: z.string().min(1).max(500),
  amountOriginal: z.string().regex(/^-?\d+(\.\d+)?$/, 'monto numérico'),
  currencyOriginal: z.enum(['ARS', 'USD']),
  kind: z.enum(['income', 'expense']),
  merchant: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
  suggestedCategory: z.string().max(200).optional(),
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
    out.date = out.fecha ?? out.transaction_date;
  }
  if (out.kind == null) {
    out.kind = out.tipo ?? out.type;
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

  return out;
}, parsedTxLineStrictSchema);

export type ParsedTxLine = z.infer<typeof parsedTxLineStrictSchema>;

export const parserOutputSchema = z.object({
  lines: z.array(parsedTxLineSchema),
});

export type ParserOutput = { lines: ParsedTxLine[] };

export type Parser = {
  id: string;
  institutionMatch: (institutionName: string) => boolean;
  importTypeMatch: (type: ImportType) => boolean;
  systemPrompt: string;
  userPrompt: string;
  schema: typeof parserOutputSchema;
};
