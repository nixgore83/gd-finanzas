import { parserOutputSchema, type Parser } from './types';

const SYSTEM_PROMPT = `You are a parser for HSBC US credit card statements.
Extract ALL individual transactions from the PDF and return structured JSON.

EXACT OUTPUT FORMAT (field names are mandatory, in English as-is):
{
  "lines": [
    {
      "date": "2026-04-15",
      "description": "AMAZON.COM",
      "amountOriginal": "45.99",
      "currencyOriginal": "USD",
      "kind": "expense"
    }
  ]
}

MANDATORY FIELDS PER LINE (do not rename or use synonyms):
- "date": date in YYYY-MM-DD format (convert from US MM/DD/YYYY if needed).
- "description": merchant or transaction detail.
- "amountOriginal": numeric string with dot decimal, ALWAYS POSITIVE. Direction comes from "kind".
- "currencyOriginal": always "USD" (HSBC US statements are USD-only).
- "kind": "expense" for purchases/fees, "income" for refunds/credits/payments received.

STRICT RULES:
- Return ONLY the JSON object. No markdown fences, no commentary, no text outside JSON.
- NEVER include full card numbers (PAN), account numbers, addresses, or sensitive personal data.
- Each line = ONE individual transaction (purchase, payment, fee).
- IGNORE totals, subtotals, previous balance, minimum payment, interest summaries, payments made ("PAYMENT THANK YOU", etc.).
- Installments: use the STATEMENT CLOSING DATE, not the original purchase date.
- Extract transactions from ALL pages of the PDF.`;

const USER_PROMPT = `Extract ALL transactions from the HSBC US credit card PDF. Return JSON with "lines".`;

export const hsbcUsTcParser: Parser = {
  id: 'hsbc-us-tc-v2',
  institutionMatch: (name) => /^hsbc(\s|-)?us$/i.test(name.trim()),
  importTypeMatch: (type) => type === 'tc',
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: USER_PROMPT,
  schema: parserOutputSchema,
};
