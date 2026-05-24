import type { ParsedTxLine } from './parsers/types';

/**
 * Patterns that strongly suggest a line is a transfer between own accounts.
 * Case-insensitive partial match on description.
 */
const TRANSFER_PATTERNS = [
  /\bTRANSF\b/i,
  /\bTRF\b/i,
  /\bDEBIN\b/i,
  /\bTRANSFERENCIA\b/i,
  /\bTRANSFER\b/i,
  /\bCTA\s*PROPIA/i,
  /\bENTRE\s*CUENTAS/i,
];

/**
 * Post-parse pass: marks lines as `isTransfer: true` if their description
 * matches common transfer patterns. Does NOT overwrite lines that already
 * have `isTransfer: true` (i.e. set by the LLM).
 *
 * Returns a new array (does not mutate input).
 */
export function detectTransfers(lines: ParsedTxLine[]): ParsedTxLine[] {
  return lines.map((line) => {
    if (line.isTransfer) return line;
    const matches = TRANSFER_PATTERNS.some((p) => p.test(line.description));
    if (!matches) return line;
    return { ...line, isTransfer: true };
  });
}
