import { getPdfPasswordEncKeyRaw } from '@/lib/env';
import {
  SecretBoxError,
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  parseSecretKey,
} from '@/lib/crypto/secret-box';

/**
 * Binding entre `secret-box` y la env var `PDF_PASSWORD_ENC_KEY`.
 *
 * Reglas:
 * - **Solo server.** Se usa únicamente desde Server Actions / route handlers /
 *   Server Components (no importamos el paquete `server-only` para no sumar una
 *   dependencia). El plaintext NUNCA sale al cliente (ni como prop, ni en un
 *   `defaultValue`, ni en un payload de RSC). Los componentes reciben, como
 *   mucho, un booleano "hay contraseña guardada".
 * - **Nunca loguear** el valor (ni cifrado ni en claro): los `console.*` de este
 *   módulo y de sus consumidores solo llevan ids y códigos de error.
 * - Sin `PDF_PASSWORD_ENC_KEY`, guardar una contraseña **falla explícito**
 *   (`PdfPasswordKeyMissingError`), no en silencio.
 *
 * Compatibilidad legacy: hasta correr el backfill
 * (`npm run db:encrypt-pdf-passwords`) puede haber valores en texto plano en DB.
 * `decryptPdfPassword` los devuelve tal cual (con warn sin valor) para no romper
 * los imports en la ventana entre deploy y backfill. Una vez migrados, todos los
 * valores empiezan con `v1:`.
 */

export class PdfPasswordKeyMissingError extends Error {
  constructor() {
    super(
      'PDF_PASSWORD_ENC_KEY no está configurada: no se pueden cifrar ni descifrar las contraseñas de PDF. ' +
        'Generá una con `node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))"` ' +
        'y seteala en las env vars de Vercel.',
    );
    this.name = 'PdfPasswordKeyMissingError';
  }
}

function requireKey(): Buffer {
  const raw = getPdfPasswordEncKeyRaw();
  if (!raw) throw new PdfPasswordKeyMissingError();
  try {
    return parseSecretKey(raw);
  } catch (err) {
    if (err instanceof SecretBoxError) {
      // El mensaje describe el formato esperado; nunca incluye la clave.
      throw new Error(`PDF_PASSWORD_ENC_KEY inválida: ${err.message}`);
    }
    throw err;
  }
}

/** true si la clave maestra está configurada (para gatear UI/acciones sin tirar). */
export function hasPdfPasswordKey(): boolean {
  return getPdfPasswordEncKeyRaw() !== undefined;
}

/** Cifra una contraseña de PDF para persistirla. Tira si no hay clave. */
export function encryptPdfPassword(plaintext: string): string {
  return encryptSecret(plaintext, requireKey());
}

/**
 * Devuelve la contraseña en claro a partir de lo guardado en DB.
 * - `null`/vacío → `null`.
 * - payload `v1:...` → descifra (tira si la clave falta o no verifica).
 * - texto plano legacy → lo devuelve tal cual (pendiente de backfill).
 */
export function decryptPdfPassword(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!isEncryptedSecret(stored)) {
    // Sin montos, sin ids de secreto, sin el valor: solo la señal de que falta migrar.
    console.warn('[crypto] pdf password en texto plano (pendiente de backfill)');
    return stored;
  }
  return decryptSecret(stored, requireKey());
}
