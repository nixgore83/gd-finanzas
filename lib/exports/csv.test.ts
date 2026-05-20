import { describe, it, expect } from 'vitest';
import { toCsv } from './csv';

const HEADERS = [
  { key: 'a', label: 'Col A' },
  { key: 'b', label: 'Col B' },
] as const;

describe('toCsv', () => {
  it('arranca con BOM UTF-8', () => {
    const out = toCsv<{ a: string; b: string }>([{ a: 'x', b: 'y' }], HEADERS);
    expect(out.charCodeAt(0)).toBe(0xfeff);
  });

  it('header row + filas con CRLF', () => {
    const out = toCsv<{ a: string; b: string }>(
      [
        { a: '1', b: '2' },
        { a: '3', b: '4' },
      ],
      HEADERS,
    );
    const lines = out.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe('Col A,Col B');
    expect(lines[1]).toBe('1,2');
    expect(lines[2]).toBe('3,4');
  });

  it('escapa comillas y comas', () => {
    const out = toCsv<{ a: string; b: string }>(
      [{ a: 'hello, world', b: 'she said "hi"' }],
      HEADERS,
    );
    expect(out).toContain('"hello, world","she said ""hi"""');
  });

  it('null/undefined → string vacío', () => {
    const out = toCsv<{ a: unknown; b: unknown }>([{ a: null, b: undefined }], HEADERS);
    const lines = out.replace(/^﻿/, '').split('\r\n');
    expect(lines[1]).toBe(',');
  });

  it('arr vacío → solo header', () => {
    const out = toCsv<{ a: string; b: string }>([], HEADERS);
    const body = out.replace(/^﻿/, '');
    expect(body).toBe('Col A,Col B\r\n');
  });

  it('numbers y booleans serializan sin transform', () => {
    const out = toCsv<{ a: number; b: boolean }>(
      [
        { a: 1234.56, b: true },
        { a: 0, b: false },
      ],
      HEADERS,
    );
    expect(out).toContain('1234.56,true');
    expect(out).toContain('0,false');
  });

  it('newlines internos quoted', () => {
    const out = toCsv<{ a: string; b: string }>([{ a: 'line1\nline2', b: 'x' }], HEADERS);
    expect(out).toContain('"line1\nline2",x');
  });
});
