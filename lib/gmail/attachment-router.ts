import type { ACCOUNT_TYPES, CARD_BRANDS, CURRENCIES } from '@/lib/schemas/account';
import { unlockPdfForImport } from '@/lib/imports/pdf-decrypt';

type AccountType = (typeof ACCOUNT_TYPES)[number];
type Currency = (typeof CURRENCIES)[number];
type CardBrand = (typeof CARD_BRANDS)[number];

export interface RoutableAccount {
  id: string;
  name: string;
  type: AccountType;
  cardBrand: CardBrand | null;
  currencyDefault: Currency;
  institutionId: string | null;
  /** Nº de cuenta como viene en el extracto, ej. "0905/11102104/13". */
  accountNumber: string | null;
  pdfPassword: string | null;
}

interface RouteResult {
  account: RoutableAccount;
  /**
   * Bytes listos para guardar. Por la vía del sufijo son los bytes crudos (el
   * PDF no hizo falta abrirlo): `parseImportInternal` los descifra después con
   * la cascada buena. Por la vía del contenido ya vienen descifrados.
   */
  bytes: Uint8Array;
}

/**
 * Adjuntos que NO son extractos y nunca deben generar un import.
 * `CARATULA` es la portada; `AV. FALTA DE FON` es un aviso de falta de fondos.
 */
const SKIP_FILENAME_PATTERNS = [/^CARATULA/i, /^AV\.\s*FALTA\s+DE\s+FON/i];

/**
 * Sufijos de cuenta para los que SÍ importamos los avisos de transferencia
 * (`AV.TRANSF.MINORISTAS`).
 *
 * Decisión Nico 2026-08-25: solo la caja de ahorro USD (`0905/11102104/13` →
 * `0413`). La caja ARS 0926 (`9430`) se alimenta del CSV de movimientos del
 * homebanking, que es su fuente de verdad; importar además los avisos ya duplicó
 * `TR.7782699` y `TR.7795790`. Si esta lista crece, el paso siguiente es una
 * columna por cuenta en `accounts`, no más constantes acá.
 */
export const TRANSFER_NOTICE_SUFFIXES = ['0413'];

const TRANSFER_NOTICE_FILENAME = /^AV\.\s*TRANSF/i;

/**
 * Sufijo con el que ICBC nombra los adjuntos de una cuenta: los **últimos 2
 * dígitos del número de cuenta + la sucursal**.
 *
 *   "0905/11102104/13" → "0413"
 *   "0926/01109094/30" → "9430"
 *   "0905/02100757/27" → "5727"
 */
export function accountNumberSuffix(accountNumber: string | null | undefined): string | null {
  if (!accountNumber) return null;
  const parts = accountNumber.split('/');
  if (parts.length < 3) return null;
  const middle = parts[1]!.trim();
  const branch = parts[2]!.trim();
  if (!/^\d+$/.test(middle) || !/^\d+$/.test(branch)) return null;
  if (middle.length < 2 || branch.length !== 2) return null;
  return `${middle.slice(-2)}${branch}`;
}

/** Extrae el sufijo de cuenta del nombre del adjunto: "…-0413.PDF" → "0413". */
export function filenameSuffix(filename: string): string | null {
  const match = /-(\d{4})\.(?:pdf|csv)$/i.exec(filename.trim());
  return match ? match[1]! : null;
}

/**
 * Dado un adjunto (posiblemente cifrado) y las cuentas candidatas que comparten
 * el mismo label de Gmail, determina a qué cuenta pertenece.
 *
 * Orden: skip por filename → ruteo por sufijo (sin abrir el PDF) → fallback por
 * contenido de la primera página.
 *
 * Devuelve `null` cuando el adjunto debe saltearse:
 * - Carátulas y avisos que no son extractos
 * - Avisos de transferencia de una cuenta que no está en `TRANSFER_NOTICE_SUFFIXES`
 * - Extractos sin movimientos (SIN MOVIMIENTOS)
 * - Formato no reconocido, o PDF que no se pudo descifrar
 */
export async function routeAttachment(
  rawBytes: Uint8Array,
  filename: string,
  accounts: RoutableAccount[],
): Promise<RouteResult | null> {
  if (SKIP_FILENAME_PATTERNS.some((p) => p.test(filename.trim()))) return null;

  const suffix = filenameSuffix(filename);

  // Los avisos de transferencia solo se importan para las cuentas habilitadas.
  if (TRANSFER_NOTICE_FILENAME.test(filename.trim())) {
    if (!suffix || !TRANSFER_NOTICE_SUFFIXES.includes(suffix)) return null;
  }

  // ── Ruteo por sufijo: determinístico y no necesita abrir el PDF ──
  if (suffix) {
    const bySuffix = accounts.find((a) => accountNumberSuffix(a.accountNumber) === suffix);
    if (bySuffix) return { account: bySuffix, bytes: rawBytes };
  }

  // ── Fallback por contenido ──
  const bytes = await unlockWithAnyPassword(rawBytes, accounts);
  if (!bytes) return null;

  const text = await extractFirstPageText(bytes);
  if (!text) return null;

  // Extractos vacíos
  if (/SIN\s+MOVIMIENTOS/i.test(text)) return null;

  const match = identifyAccount(text);
  if (!match) return null;

  // Para TC puede haber varias cuentas con mismo type+currency (ICBC Visa +
  // ICBC Mastercard, ambas credit_card ARS). Se desambigua por `card_brand` —
  // antes se matcheaba contra `name`, que ya no embebe la marca — con fallback
  // al rótulo.
  const target = match.accountNamePattern
    ? accounts.find(
        (a) =>
          a.type === match.type &&
          a.currencyDefault === match.currency &&
          match.accountNamePattern!.test(`${a.cardBrand ?? ''} ${a.name}`),
      ) ??
      accounts.find((a) => a.type === match.type && a.currencyDefault === match.currency)
    : accounts.find((a) => a.type === match.type && a.currencyDefault === match.currency);
  if (!target) return null;

  return { account: target, bytes };
}

/**
 * Intenta desbloquear el PDF con cada contraseña distinta del grupo (más "sin
 * contraseña"). Devuelve `null` si ninguna funcionó: NUNCA seguimos con bytes
 * todavía cifrados, porque el lector de texto los lee como basura y el adjunto
 * se descarta en silencio — que es exactamente el bug que esto arregla.
 */
async function unlockWithAnyPassword(
  bytes: Uint8Array,
  accounts: RoutableAccount[],
): Promise<Uint8Array | null> {
  const passwords: Array<string | null> = [
    ...new Set(accounts.map((a) => a.pdfPassword).filter((p): p is string => !!p)),
    null,
  ];

  for (const password of passwords) {
    const res = await unlockPdfForImport(bytes, password);
    if (res.ok) return res.bytes;
  }
  return null;
}

interface AccountMatch {
  type: AccountType;
  currency: Currency;
  /** Patrón opcional para desambiguar por marca de tarjeta. */
  accountNamePattern?: RegExp;
}

const PATTERNS: Array<{
  regex: RegExp;
  type: AccountType;
  currency: Currency;
  accountNamePattern?: RegExp;
}> = [
  // Extractos de banco. `[\s\S]` en vez de `.` porque el texto extraído del PDF
  // trae saltos de línea entre "CAJA DE AHORRO" y la moneda.
  { regex: /CAJA\s+DE\s+AHORRO[\s\S]{0,40}?PESOS/i, type: 'bank_savings', currency: 'ARS' },
  { regex: /CAJA\s+DE\s+AHORRO[\s\S]{0,40}?D[OÓ]LARES/i, type: 'bank_savings', currency: 'USD' },
  { regex: /CUENTA\s+CORRIENTE[\s\S]{0,40}?PESOS/i, type: 'bank_checking', currency: 'ARS' },
  { regex: /CUENTA\s+CORRIENTE[\s\S]{0,40}?D[OÓ]LARES/i, type: 'bank_checking', currency: 'USD' },
  // Resúmenes de tarjeta — el orden importa: marcas específicas antes que genéricos.
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
