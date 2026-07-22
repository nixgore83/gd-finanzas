import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifrado simétrico autenticado para secretos que la app **necesita recuperar en
 * claro** (no son passwords de login: no sirve hashear). Hoy: las contraseñas de
 * PDF de extractos bancarios.
 *
 * Algoritmo: AES-256-GCM (`node:crypto`, sin dependencias nuevas, corre tal cual
 * en Vercel Functions/Node).
 *   - IV **aleatorio de 12 bytes por operación** (nunca reusar IV con GCM).
 *   - Auth tag de 16 bytes → detecta manipulación del ciphertext en DB.
 *   - AAD = la etiqueta de versión, así un payload no se puede "degradar" a otro
 *     esquema cambiándole el prefijo.
 *
 * Formato del payload persistido (texto, cabe en la columna `text` actual):
 *
 *     v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
 *
 * El prefijo de versión permite rotar esquema/algoritmo más adelante sin
 * ambigüedad y distinguir un valor cifrado de un legacy en texto plano.
 *
 * La clave maestra NO vive acá: estas funciones son puras y la reciben por
 * parámetro (ver `lib/crypto/pdf-password.ts` para el binding con la env var).
 */

export const SECRET_BOX_VERSION = 'v1';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Error de cifrado/descifrado. Nunca incluye el secreto ni la clave en el mensaje. */
export class SecretBoxError extends Error {
  readonly code:
    | 'invalid_key'
    | 'invalid_payload'
    | 'unsupported_version'
    | 'decrypt_failed'
    | 'empty_plaintext';

  constructor(code: SecretBoxError['code'], message: string) {
    super(message);
    this.name = 'SecretBoxError';
    this.code = code;
  }
}

/**
 * Valida y normaliza la clave maestra: 32 bytes en base64 (también acepta hex de
 * 64 chars por comodidad). Tira `SecretBoxError('invalid_key')` con mensaje
 * explícito si falta o no mide 32 bytes — nunca falla en silencio.
 */
export function parseSecretKey(raw: string | undefined | null): Buffer {
  if (!raw || raw.trim().length === 0) {
    throw new SecretBoxError('invalid_key', 'clave de cifrado ausente');
  }
  const trimmed = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new SecretBoxError(
      'invalid_key',
      `clave de cifrado inválida: se esperaban ${KEY_BYTES} bytes (base64 o hex), llegaron ${key.length}`,
    );
  }
  return key;
}

/** true si el valor guardado tiene formato de payload cifrado (vs. legacy en claro). */
export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${SECRET_BOX_VERSION}:`);
}

/** Cifra `plaintext` y devuelve el payload versionado listo para persistir. */
export function encryptSecret(plaintext: string, key: Buffer): string {
  if (plaintext.length === 0) {
    throw new SecretBoxError('empty_plaintext', 'no se cifra un secreto vacío');
  }
  if (key.length !== KEY_BYTES) {
    throw new SecretBoxError('invalid_key', 'clave de cifrado inválida');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(SECRET_BOX_VERSION, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SECRET_BOX_VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Descifra un payload `v1:...`. Tira si el formato es inválido, la versión no se
 * reconoce, o la clave/el auth tag no verifican (ciphertext manipulado).
 */
export function decryptSecret(payload: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new SecretBoxError('invalid_key', 'clave de cifrado inválida');
  }
  const parts = payload.split(':');
  if (parts.length !== 4) {
    throw new SecretBoxError('invalid_payload', 'payload cifrado con formato inválido');
  }
  const [version, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  if (version !== SECRET_BOX_VERSION) {
    throw new SecretBoxError('unsupported_version', `versión de cifrado no soportada: ${version}`);
  }
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretBoxError('invalid_payload', 'payload cifrado con formato inválido');
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(SECRET_BOX_VERSION, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    // No propagamos el error de OpenSSL: no aporta y podría filtrar detalles.
    throw new SecretBoxError(
      'decrypt_failed',
      'no se pudo descifrar el secreto (clave incorrecta o dato corrupto)',
    );
  }
}
