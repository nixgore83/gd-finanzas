import type { ImportType } from '@/lib/schemas/import';
import { galiciaTcParser } from './galicia-tc';
import { icbcTcParser } from './icbc-tc';
import { icbcBancoParser } from './icbc-banco';
import { hsbcUsTcParser } from './hsbc-us-tc';
import { hsbcUsBancoParser } from './hsbc-us-banco';
import type { Parser } from './types';

const PARSERS: Parser[] = [
  galiciaTcParser,
  icbcTcParser,
  icbcBancoParser,
  hsbcUsTcParser,
  hsbcUsBancoParser,
];

export function resolveParser(institutionName: string, importType: ImportType): Parser | null {
  for (const p of PARSERS) {
    if (p.institutionMatch(institutionName) && p.importTypeMatch(importType)) return p;
  }
  return null;
}

export function listParsers(): Parser[] {
  return PARSERS;
}
