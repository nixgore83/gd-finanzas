import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { emailSchema, mfaCodeSchema, isAllowedEmail, getAllowedEmails } from './auth';

describe('emailSchema', () => {
  it('parses a valid email', () => {
    expect(emailSchema.parse('foo@bar.com')).toBe('foo@bar.com');
  });

  it('lowercases and trims', () => {
    expect(emailSchema.parse('  Foo@Bar.COM  ')).toBe('foo@bar.com');
  });

  it('rejects invalid', () => {
    expect(() => emailSchema.parse('not-an-email')).toThrow();
    expect(() => emailSchema.parse('')).toThrow();
  });
});

describe('mfaCodeSchema', () => {
  it('accepts a 6-digit numeric string', () => {
    expect(mfaCodeSchema.parse('123456')).toBe('123456');
  });

  it('trims whitespace', () => {
    expect(mfaCodeSchema.parse('  123456  ')).toBe('123456');
  });

  it('rejects 5 or 7 digits', () => {
    expect(() => mfaCodeSchema.parse('12345')).toThrow();
    expect(() => mfaCodeSchema.parse('1234567')).toThrow();
  });

  it('rejects non-numeric', () => {
    expect(() => mfaCodeSchema.parse('12345a')).toThrow();
    expect(() => mfaCodeSchema.parse('abcdef')).toThrow();
  });

  it('rejects empty', () => {
    expect(() => mfaCodeSchema.parse('')).toThrow();
  });
});

describe('allowed emails', () => {
  const original = process.env.ALLOWED_EMAILS;

  beforeEach(() => {
    process.env.ALLOWED_EMAILS = 'nico@example.com, Pau@example.com ';
  });

  afterEach(() => {
    process.env.ALLOWED_EMAILS = original;
  });

  it('parses, trims, and lowercases the list', () => {
    expect(getAllowedEmails()).toEqual(['nico@example.com', 'pau@example.com']);
  });

  it('isAllowedEmail is case-insensitive', () => {
    expect(isAllowedEmail('NICO@example.com')).toBe(true);
    expect(isAllowedEmail('intruso@example.com')).toBe(false);
  });

  it('handles empty ALLOWED_EMAILS', () => {
    process.env.ALLOWED_EMAILS = '';
    expect(getAllowedEmails()).toEqual([]);
    expect(isAllowedEmail('any@example.com')).toBe(false);
  });
});
