import { parserOutputSchema, type Parser } from './types';

const SYSTEM_PROMPT = `You are a parser for HSBC US checking/savings account statements. The input can be a PDF document or a CSV transaction export.

STRICT RULES:
- Return ONLY a JSON object of the shape { "lines": [...] }.
- NO markdown fences, NO commentary.
- NEVER include account numbers, routing numbers, or sensitive personal data.
- Each line = ONE movement (deposit, withdrawal, fee, transfer).
- IGNORE running balances, statement headers, and summary rows.
- Dates in YYYY-MM-DD format (convert from US MM/DD/YYYY if needed).
- Amounts: positive string with dot decimal separator; the "kind" field carries direction.
- "kind": "income" for credits (deposits, refunds, interest), "expense" for debits (withdrawals, fees, transfers out).
- "currencyOriginal": "USD".
- "description": glosa del movimiento (merchant, source, or memo line). Si la fuente es CSV, usar la columna Description / Memo.`;

const USER_PROMPT = `Extract all transactions from the HSBC US account statement that follows. Return JSON with "lines".`;

export const hsbcUsBancoParser: Parser = {
  id: 'hsbc-us-banco-v1',
  institutionMatch: (name) => /^hsbc(\s|-)?us$/i.test(name.trim()),
  importTypeMatch: (type) => type === 'banco',
  // El archivo puede ser PDF o CSV; el runner elige según extensión.
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: USER_PROMPT,
  schema: parserOutputSchema,
};
