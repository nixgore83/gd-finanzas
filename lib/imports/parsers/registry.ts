import type { ImportType } from '@/lib/schemas/import';
import { galiciaTcParser } from './galicia-tc';
import { icbcMastercardTcParser } from './icbc-mastercard-tc';
import { icbcTcParser } from './icbc-tc';
import { icbcBancoParser } from './icbc-banco';
import { bnaTcParser } from './bna-tc';
import { hsbcUsTcParser } from './hsbc-us-tc';
import { hsbcUsBancoParser } from './hsbc-us-banco';
import { mercadoPagoTcParser } from './mercado-pago-tc';
import { balanzBrokerParser } from './balanz-broker';
import { cocosBrokerParser } from './cocos-broker';
import type { Parser } from './types';

// Order matters: more specific parsers (with accountMatch) go before generic ones.
const PARSERS: Parser[] = [
  galiciaTcParser,
  icbcMastercardTcParser, // before generic icbc-tc — accountMatch narrows it
  icbcTcParser,
  icbcBancoParser,
  bnaTcParser,
  hsbcUsTcParser,
  hsbcUsBancoParser,
  mercadoPagoTcParser,
  balanzBrokerParser,
  cocosBrokerParser,
];

/**
 * Resolve the best parser for a given institution + type + optional account name.
 *
 * When `accountName` is provided, parsers with `accountMatch` are tried first.
 * Falls back to institution + type only (backward compat for imports without account).
 */
export function resolveParser(
  institutionName: string,
  importType: ImportType,
  accountName?: string,
): Parser | null {
  // Pass 1: if accountName provided, prefer parsers that match it
  if (accountName) {
    for (const p of PARSERS) {
      if (
        p.institutionMatch(institutionName) &&
        p.importTypeMatch(importType) &&
        p.accountMatch?.(accountName)
      ) {
        return p;
      }
    }
  }

  // Pass 2: fallback — parsers without accountMatch, or whose accountMatch we didn't satisfy
  for (const p of PARSERS) {
    if (p.institutionMatch(institutionName) && p.importTypeMatch(importType)) {
      // Skip parsers with accountMatch (they're specialized — use only via Pass 1)
      if (p.accountMatch) continue;
      return p;
    }
  }

  // Pass 3: absolute fallback — any institution+type match (even with accountMatch)
  for (const p of PARSERS) {
    if (p.institutionMatch(institutionName) && p.importTypeMatch(importType)) return p;
  }

  return null;
}

export function listParsers(): Parser[] {
  return PARSERS;
}
