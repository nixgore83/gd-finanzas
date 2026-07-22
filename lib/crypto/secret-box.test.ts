import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  SecretBoxError,
  SECRET_BOX_VERSION,
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  parseSecretKey,
} from './secret-box';

// Claves y valores SINTÉTICOS. Nunca meter secretos reales en tests.
const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const SAMPLE = 'clave-de-prueba-123';

describe('parseSecretKey', () => {
  it('acepta base64 de 32 bytes', () => {
    const raw = randomBytes(32).toString('base64');
    expect(parseSecretKey(raw)).toHaveLength(32);
  });

  it('acepta hex de 64 chars', () => {
    const raw = randomBytes(32).toString('hex');
    expect(parseSecretKey(raw)).toHaveLength(32);
  });

  it('ignora espacios alrededor', () => {
    const raw = randomBytes(32).toString('base64');
    expect(parseSecretKey(`  ${raw}  `)).toHaveLength(32);
  });

  it('falla explícito si falta', () => {
    expect(() => parseSecretKey(undefined)).toThrow(SecretBoxError);
    expect(() => parseSecretKey('')).toThrow(/ausente/);
    expect(() => parseSecretKey('   ')).toThrow(/ausente/);
  });

  it('falla si no mide 32 bytes', () => {
    expect(() => parseSecretKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('encryptSecret / decryptSecret', () => {
  it('hace round-trip', () => {
    const payload = encryptSecret(SAMPLE, KEY);
    expect(decryptSecret(payload, KEY)).toBe(SAMPLE);
  });

  it('emite el formato versionado v1:<iv>:<tag>:<ct>', () => {
    const parts = encryptSecret(SAMPLE, KEY).split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe(SECRET_BOX_VERSION);
    expect(Buffer.from(parts[1]!, 'base64')).toHaveLength(12);
    expect(Buffer.from(parts[2]!, 'base64')).toHaveLength(16);
  });

  it('nunca deja el plaintext visible en el payload', () => {
    expect(encryptSecret(SAMPLE, KEY)).not.toContain(SAMPLE);
  });

  it('usa un IV distinto por operación (mismo input → payload distinto)', () => {
    const a = encryptSecret(SAMPLE, KEY);
    const b = encryptSecret(SAMPLE, KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe(decryptSecret(b, KEY));
  });

  it('soporta unicode y strings largos', () => {
    const value = 'ñ-áé😀-' + 'x'.repeat(100);
    expect(decryptSecret(encryptSecret(value, KEY), KEY)).toBe(value);
  });

  it('rechaza cifrar vacío', () => {
    expect(() => encryptSecret('', KEY)).toThrow(/vacío/);
  });

  it('rechaza claves de tamaño inválido', () => {
    expect(() => encryptSecret(SAMPLE, Buffer.alloc(16))).toThrow(SecretBoxError);
    expect(() => decryptSecret(encryptSecret(SAMPLE, KEY), Buffer.alloc(16))).toThrow(
      SecretBoxError,
    );
  });

  it('falla con otra clave', () => {
    const payload = encryptSecret(SAMPLE, KEY);
    expect(() => decryptSecret(payload, OTHER_KEY)).toThrow(/no se pudo descifrar/);
  });

  it('detecta manipulación del ciphertext (auth tag)', () => {
    const [v, iv, tag, ct] = encryptSecret(SAMPLE, KEY).split(':') as [
      string,
      string,
      string,
      string,
    ];
    const tampered = Buffer.from(ct, 'base64');
    tampered[0] = tampered[0]! ^ 0xff;
    const payload = [v, iv, tag, tampered.toString('base64')].join(':');
    expect(() => decryptSecret(payload, KEY)).toThrow(/no se pudo descifrar/);
  });

  it('detecta manipulación del auth tag', () => {
    const [v, iv, tag, ct] = encryptSecret(SAMPLE, KEY).split(':') as [
      string,
      string,
      string,
      string,
    ];
    const tampered = Buffer.from(tag, 'base64');
    tampered[0] = tampered[0]! ^ 0xff;
    const payload = [v, iv, tampered.toString('base64'), ct].join(':');
    expect(() => decryptSecret(payload, KEY)).toThrow(/no se pudo descifrar/);
  });

  it('rechaza payloads mal formados', () => {
    expect(() => decryptSecret('texto-plano', KEY)).toThrow(/formato inválido/);
    expect(() => decryptSecret('v1:a:b', KEY)).toThrow(/formato inválido/);
    expect(() => decryptSecret('v1:AAAA:BBBB:CCCC', KEY)).toThrow(/formato inválido/);
  });

  it('rechaza una versión desconocida', () => {
    const payload = encryptSecret(SAMPLE, KEY).replace(/^v1:/, 'v2:');
    expect(() => decryptSecret(payload, KEY)).toThrow(/versión de cifrado no soportada/);
  });
});

describe('isEncryptedSecret', () => {
  it('reconoce payloads cifrados', () => {
    expect(isEncryptedSecret(encryptSecret(SAMPLE, KEY))).toBe(true);
  });

  it('no confunde legacy en texto plano', () => {
    expect(isEncryptedSecret('MiClavePlana')).toBe(false);
    expect(isEncryptedSecret(null)).toBe(false);
    expect(isEncryptedSecret(undefined)).toBe(false);
    expect(isEncryptedSecret('')).toBe(false);
  });
});
