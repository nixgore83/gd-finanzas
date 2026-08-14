/**
 * Desbloqueo de PDFs protegidos para el pipeline de imports.
 *
 * Cascada de dos etapas:
 *  1. `@pdfsmaller/pdf-decrypt` — rápido, cubre RC4 (V=1-2/R=2-3) y AES-256 (V=5/R=6).
 *  2. Fallback a `mupdf` (WASM) cuando pdf-decrypt no soporta el algoritmo —
 *     típicamente el **AES-128 V=4/R=4** de los resúmenes ICBC nuevos, que pdf-decrypt
 *     rechaza con "Unsupported encryption". mupdf abre, autentica y re-guarda el PDF
 *     SIN encriptación (`encrypt=none`).
 *
 * Contrato clave: NUNCA devuelve bytes todavía cifrados. Si ninguna etapa pudo
 * desbloquear, devuelve `ok: false` con el motivo, para que el caller marque el import
 * como error en vez de mandarle basura cifrada al LLM (que "parsea" 0 líneas en silencio).
 */

import type { PDFDocument } from 'mupdf';

export type PdfUnlockResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'wrong_password' | 'unsupported' };

/**
 * Desbloquea un PDF con la contraseña dada. Ver doc del módulo para la cascada.
 * `password` puede ser vacío: para un PDF con user-password vacío mupdf igual lo abre
 * (`needsPassword()` es false) y lo re-guarda descifrado.
 */
export async function unlockPdf(bytes: Uint8Array, password: string): Promise<PdfUnlockResult> {
  try {
    const { decryptPDF } = await import('@pdfsmaller/pdf-decrypt');
    const decrypted = await decryptPDF(bytes, password);
    return { ok: true, bytes: new Uint8Array(decrypted) };
  } catch (err) {
    const msg = ((err as Error)?.message ?? '').toLowerCase();
    // PDF sin encriptar: no hay nada que desbloquear, los bytes originales sirven.
    if (msg.includes('not encrypted') || msg.includes('no /encrypt dictionary')) {
      return { ok: true, bytes };
    }
    // Cualquier otro fallo de pdf-decrypt (algoritmo no soportado como el AES-128 de
    // ICBC, o contraseña incorrecta): mupdf decide con autoridad — descifra si puede,
    // o nos dice si la contraseña está mal.
    return unlockWithMupdf(bytes, password);
  }
}

/**
 * Motivo por el que un PDF no se pudo dejar listo para el parser.
 * - `locked_no_password`: el PDF pide contraseña y NO teníamos ninguna configurada.
 * - `wrong_password`: teníamos una contraseña y no abrió.
 * - `unsupported`: ni mupdf pudo abrir el archivo (y el usuario declaró que está protegido).
 */
export type PdfUnlockForImportResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'locked_no_password' | 'wrong_password' | 'unsupported' };

/**
 * Deja un PDF listo para mandarle al parser (LLM), decidiendo qué es fatal y qué no.
 *
 * Se intenta desbloquear SIEMPRE, incluso sin contraseña configurada (`password` null),
 * por dos motivos:
 *  1. Hay resúmenes con diccionario /Encrypt pero user-password VACÍO (solo owner-password).
 *     mupdf los abre sin problema, pero la API de Anthropic rechaza cualquier PDF con
 *     /Encrypt con 400 "The PDF specified is password protected". Desencriptarlos acá los
 *     vuelve importables.
 *  2. Si el PDF sí tiene contraseña real y no la cargamos, queremos un error accionable
 *     ("cargá la contraseña") y no un `LLM api_failure` críptico.
 *
 * Leniencia deliberada: si NO hay contraseña configurada y el archivo no se puede ni abrir
 * (`unsupported`), NO es fatal: seguimos con los bytes originales y que el parser intente.
 * Un PDF realmente cifrado que mupdf abre reporta `wrong_password`, nunca `unsupported`, así
 * que el contrato "nunca mandamos bytes cifrados al LLM" se mantiene.
 */
/**
 * Cuántos bytes de basura toleramos antes del header `%PDF`. El propio spec de
 * PDF permite hasta 1024 bytes de preámbulo y los lectores lo aceptan, así que
 * el margen es generoso a propósito; más allá de eso el archivo probablemente
 * no sea un PDF y preferimos no "arreglarlo".
 */
const MAX_PDF_HEADER_OFFSET = 1024;

/**
 * Descarta lo que haya antes del header `%PDF`.
 *
 * Por qué existe: los extractos de la caja de HSBC US llegan con un salto de
 * línea suelto en el byte 0, así que el header arranca en el offset 1. Los
 * lectores de PDF lo toleran (mupdf y pdf-parse los abren sin chistar), pero la
 * API de Anthropic exige el header en el byte 0 y responde
 * "The PDF specified was not valid" — un error que no menciona el offset y que
 * manda a buscar el problema en el archivo entero.
 *
 * Devuelve los bytes tal cual si el header ya está al principio, o si no
 * aparece dentro del margen (ahí no hay nada que sanear con confianza).
 */
export function stripPdfPreamble(bytes: Uint8Array): Uint8Array {
  // "%PDF" = 0x25 0x50 0x44 0x46
  const limit = Math.min(bytes.length - 4, MAX_PDF_HEADER_OFFSET);
  for (let i = 0; i <= limit; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46) {
      return i === 0 ? bytes : bytes.slice(i);
    }
  }
  return bytes;
}

export async function unlockPdfForImport(
  bytes: Uint8Array,
  password: string | null | undefined,
): Promise<PdfUnlockForImportResult> {
  // Sanear ANTES de intentar desbloquear: un preámbulo suelto también confunde
  // a los lectores de PDF, no sólo a la API.
  const clean = stripPdfPreamble(bytes);
  const res = await unlockPdf(clean, password ?? '');
  if (res.ok) return res;
  if (res.reason === 'wrong_password') {
    return { ok: false, reason: password ? 'wrong_password' : 'locked_no_password' };
  }
  // `unsupported` sin contraseña declarada → no lo damos por perdido.
  return password ? { ok: false, reason: 'unsupported' } : { ok: true, bytes: clean };
}

async function unlockWithMupdf(bytes: Uint8Array, password: string): Promise<PdfUnlockResult> {
  const mupdf = await import('mupdf');

  let doc: PDFDocument;
  try {
    doc = new mupdf.PDFDocument(bytes);
  } catch {
    // No es un PDF que mupdf pueda abrir (corrupto / formato desconocido).
    return { ok: false, reason: 'unsupported' };
  }

  try {
    if (doc.needsPassword()) {
      // authenticatePassword devuelve 0 si falla, !=0 si autenticó (user u owner).
      if (doc.authenticatePassword(password) === 0) {
        return { ok: false, reason: 'wrong_password' };
      }
    }
    const clean = doc.saveToBuffer('encrypt=none').asUint8Array();
    return { ok: true, bytes: new Uint8Array(clean) };
  } finally {
    doc.destroy();
  }
}
