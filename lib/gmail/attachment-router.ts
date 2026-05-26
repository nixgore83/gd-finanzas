import type { ACCOUNT_TYPES, CURRENCIES } from '@/lib/schemas/account';

type AccountType = (typeof ACCOUNT_TYPES)[number];
type Currency = (typeof CURRENCIES)[number];

export interface RoutableAccount {
  id: string;
  name: string;
  type: AccountType;
  currencyDefault: Currency;
  institutionId: string | null;
  pdfPassword: string | null;
}

interface RouteResult {
  account: RoutableAccount;
  /** PDF bytes, already decrypted (ready for storage / parsing). */
  decryptedBytes: Uint8Array;
}

/**
 * Given a raw (possibly encrypted) PDF attachment and a list of candidate
 * accounts that share the same Gmail label, determines which account the
 * PDF belongs to.
 *
 * Returns `null` when the PDF should be skipped:
 * - Cover pages (CARATULA)
 * - Statements with no movements (SIN MOVIMIENTOS)
 * - Unrecognised format
 */
export async function routeAttachment(
  rawBytes: Uint8Array,
  filename: string,
  accounts: RoutableAccount[],
): Promise<RouteResult | null> {
  // Quick skip by filename
  if (/^CARATULA/i.test(filename)) return null;

  // Decrypt if needed — grab the password from the first account that has one
  const password = accounts.find((a) => a.pdfPassword)?.pdfPassword;
  let bytes = rawBytes;
  if (password) {
    try {
      const { decryptPDF } = await import('@pdfsmaller/pdf-decrypt');
      const decrypted = await decryptPDF(rawBytes, password);
      bytes = new Uint8Array(decrypted);
    } catch {
      // If decryption fails, try with raw bytes (maybe it's not encrypted)
      bytes = rawBytes;
    }
  }

  // Extract text from first page
  const text = await extractFirstPageText(bytes);
  if (!text) return null;

  // Skip empty statements
  if (/SIN\s+MOVIMIENTOS/i.test(text)) return null;

  // Identify account type + currency from content
  const match = identifyAccount(text);
  if (!match) return null;

  // Find the matching account.
  // For TC (credit_card) there may be multiple accounts with same type+currency
  // (e.g. ICBC Visa + ICBC Mastercard, both credit_card ARS). In that case
  // we use the accountNamePattern to disambiguate via account name.
  const target = match.accountNamePattern
    ? accounts.find(
        (a) =>
          a.type === match.type &&
          a.currencyDefault === match.currency &&
          match.accountNamePattern!.test(a.name),
      ) ??
      // Fallback: if no name match, try type+currency only
      accounts.find(
        (a) => a.type === match.type && a.currencyDefault === match.currency,
      )
    : accounts.find(
        (a) => a.type === match.type && a.currencyDefault === match.currency,
      );
  if (!target) return null;

  return { account: target, decryptedBytes: bytes };
}

interface AccountMatch {
  type: AccountType;
  currency: Currency;
  /** Optional pattern to match against account name (for disambiguation). */
  accountNamePattern?: RegExp;
}

const PATTERNS: Array<{
  regex: RegExp;
  type: AccountType;
  currency: Currency;
  accountNamePattern?: RegExp;
}> = [
  // Bank statements
  { regex: /CAJA\s+DE\s+AHORRO.*PESOS/i, type: 'bank_savings', currency: 'ARS' },
  { regex: /CAJA\s+DE\s+AHORRO.*D[OÓ]LARES/i, type: 'bank_savings', currency: 'USD' },
  { regex: /CUENTA\s+CORRIENTE.*PESOS/i, type: 'bank_checking', currency: 'ARS' },
  { regex: /CUENTA\s+CORRIENTE.*D[OÓ]LARES/i, type: 'bank_checking', currency: 'USD' },
  // Credit card statements — order matters: specific brands before generic
  { regex: /MASTERCARD/i, type: 'credit_card', currency: 'ARS', accountNamePattern: /master/i },
  { regex: /VISA/i, type: 'credit_card', currency: 'ARS', accountNamePattern: /visa/i },
];

function identifyAccount(text: string): AccountMatch | null {
  for (const p of PATTERNS) {
    if (p.regex.test(text)) {
      return {
        type: p.type,
        currency: p.currency,
        accountNamePattern: p.accountNamePattern,
      };
    }
  }
  return null;
}

async function extractFirstPageText(pdfBytes: Uint8Array): Promise<string | null> {
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: pdfBytes });
    const result = await parser.getText({ first: 1 });
    await parser.destroy();
    return result.text || null;
  } catch {
    return null;
  }
}
