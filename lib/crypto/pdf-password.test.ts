import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PdfPasswordKeyMissingError,
  decryptPdfPassword,
  encryptPdfPassword,
  hasPdfPasswordKey,
} from './pdf-password';

// Clave y valores SINTÉTICOS (jamás secretos reales en tests).
const TEST_KEY = Buffer.alloc(32, 3).toString('base64');
const SAMPLE = 'clave-sintetica-abc';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('con PDF_PASSWORD_ENC_KEY seteada', () => {
  it('hace round-trip', () => {
    vi.stubEnv('PDF_PASSWORD_ENC_KEY', TEST_KEY);
    expect(hasPdfPasswordKey()).toBe(true);
    const stored = encryptPdfPassword(SAMPLE);
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain(SAMPLE);
    expect(decryptPdfPassword(stored)).toBe(SAMPLE);
  });

  it('devuelve null si no hay nada guardado', () => {
    vi.stubEnv('PDF_PASSWORD_ENC_KEY', TEST_KEY);
    expect(decryptPdfPassword(null)).toBeNull();
    expect(decryptPdfPassword(undefined)).toBeNull();
    expect(decryptPdfPassword('')).toBeNull();
  });

  it('tolera legacy en texto plano (pendiente de backfill) y avisa sin loguear el valor', () => {
    vi.stubEnv('PDF_PASSWORD_ENC_KEY', TEST_KEY);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(decryptPdfPassword('legacy-plano')).toBe('legacy-plano');
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('legacy-plano');
  });

  it('falla si la clave no mide 32 bytes', () => {
    vi.stubEnv('PDF_PASSWORD_ENC_KEY', Buffer.alloc(8).toString('base64'));
    expect(() => encryptPdfPassword(SAMPLE)).toThrow(/PDF_PASSWORD_ENC_KEY inválida/);
  });
});

describe('sin PDF_PASSWORD_ENC_KEY', () => {
  it('hasPdfPasswordKey es false', () => {
    vi.stubEnv('PDF_PASSWORD_ENC_KEY', '');
    expect(hasPdfPasswordKey()).toBe(false);
  });

  it('cifrar falla explícito, no en silencio', () => {
    vi.stubEnv('PDF_PASSWORD_ENC_KEY', '');
    expect(() => encryptPdfPassword(SAMPLE)).toThrow(PdfPasswordKeyMissingError);
    expect(() => encryptPdfPassword(SAMPLE)).toThrow(/PDF_PASSWORD_ENC_KEY no está configurada/);
  });

  it('descifrar un payload cifrado falla explícito', () => {
    vi.stubEnv('PDF_PASSWORD_ENC_KEY', TEST_KEY);
    const stored = encryptPdfPassword(SAMPLE);
    vi.stubEnv('PDF_PASSWORD_ENC_KEY', '');
    expect(() => decryptPdfPassword(stored)).toThrow(PdfPasswordKeyMissingError);
  });
});
