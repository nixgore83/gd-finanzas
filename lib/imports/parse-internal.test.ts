import { describe, it, expect } from 'vitest';
import { isFatalDecryptError } from './parse-internal';

describe('isFatalDecryptError', () => {
  it('PDF sin encriptar → no fatal (seguimos con los bytes)', () => {
    expect(isFatalDecryptError('This PDF is not encrypted. No /Encrypt dictionary found.')).toBe(false);
  });

  it('encriptación no soportada (AES-128 V=4/R=4 de ICBC) → no fatal (mandar crudo al LLM)', () => {
    expect(
      isFatalDecryptError(
        'Failed to read PDF: Unsupported encryption: V=4, R=4. pdf-decrypt supports RC4 (V=1-2, R=2-3) and AES-256 (V=5, R=6).',
      ),
    ).toBe(false);
  });

  it('contraseña incorrecta → fatal', () => {
    expect(
      isFatalDecryptError('Incorrect password. The provided password does not match the user or owner password.'),
    ).toBe(true);
  });

  it('error genérico de desencriptación → fatal', () => {
    expect(isFatalDecryptError('Failed to decrypt PDF: something broke')).toBe(true);
  });

  it('case-insensitive', () => {
    expect(isFatalDecryptError('UNSUPPORTED ENCRYPTION: V=4, R=4')).toBe(false);
    expect(isFatalDecryptError('NOT ENCRYPTED')).toBe(false);
  });
});
