import { parserOutputSchema, type Parser } from './types';

const SYSTEM_PROMPT = `You are a parser for HSBC US credit card statements (Spanish output).
Extract individual transactions from the PDF and return structured JSON.

STRICT RULES:
- Return ONLY a JSON object of the shape { "lines": [...] }.
- NO markdown fences, NO commentary, NO text outside JSON.
- NEVER include full card numbers (PAN), account numbers, addresses, or sensitive personal data.
- Each line = ONE individual transaction (purchase, payment, fee).
- IGNORE totals, subtotals, previous balance, minimum payment, interest summaries.
- Dates in YYYY-MM-DD format (convert from US MM/DD/YYYY if needed).
- Amounts: positive string with dot decimal separator; "kind" carries direction.
- "kind": "expense" for purchases/fees, "income" for refunds/credits/payments received.
- "currencyOriginal": "USD" (HSBC US statements are USD-only).
- "description": merchant or transaction detail.`;

const USER_PROMPT = `Extract all transactions from the HSBC US credit card PDF. Return JSON with "lines".`;

export const hsbcUsTcParser: Parser = {
  id: 'hsbc-us-tc-v1',
  institutionMatch: (name) => /^hsbc(\s|-)?us$/i.test(name.trim()),
  importTypeMatch: (type) => type === 'tc',
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: USER_PROMPT,
  schema: parserOutputSchema,
};
