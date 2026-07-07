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
