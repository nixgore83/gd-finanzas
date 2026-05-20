import { z } from 'zod';
import type { ImportType } from '@/lib/schemas/import';

export const parsedTxLineSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha en formato YYYY-MM-DD'),
  description: z.string().min(1).max(500),
  amountOriginal: z.string().regex(/^-?\d+(\.\d+)?$/, 'monto numérico'),
  currencyOriginal: z.enum(['ARS', 'USD']),
  kind: z.enum(['income', 'expense']),
  merchant: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
});

export type ParsedTxLine = z.infer<typeof parsedTxLineSchema>;

export const parserOutputSchema = z.object({
  lines: z.array(parsedTxLineSchema),
});

export type ParserOutput = z.infer<typeof parserOutputSchema>;

export type Parser = {
  id: string;
  institutionMatch: (institutionName: string) => boolean;
  importTypeMatch: (type: ImportType) => boolean;
  systemPrompt: string;
  userPrompt: string;
  schema: typeof parserOutputSchema;
};
