import { describe, it, expect } from 'vitest';
import * as mupdf from 'mupdf';
import { unlockPdf, unlockPdfForImport, stripPdfPreamble } from './pdf-decrypt';

// Genera un PDF de 1 página con texto conocido, opcionalmente encriptado.
// `encryptOption` es la cadena de opciones de mupdf (ej. "encrypt=aes-128,user-password=x").
// NO usa datos reales: el contenido es un literal fijo.
function makePdf(encryptOption: string): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font('Times-Roman'));
  const resources = doc.newDictionary();
  const fontDict = doc.newDictionary();
  fontDict.put('F1', font);
  resources.put('Font', fontDict);
  const page = doc.addPage(
    [0, 0, 300, 150],
    0,
    resources,
    'BT /F1 24 Tf 20 100 Td (MOVIMIENTOS 123) Tj ET',
  );
  doc.insertPage(-1, page);
  const view = doc.saveToBuffer(encryptOption).asUint8Array();
  const copy = new Uint8Array(view); // copiar fuera de la memoria WASM antes de destroy()
  doc.destroy();
  return copy;
}

function needsPassword(bytes: Uint8Array): boolean {
  const doc = new mupdf.PDFDocument(bytes);
  const n = doc.needsPassword();
  doc.destroy();
  return n;
}

function readText(bytes: Uint8Array): string {
  const doc = new mupdf.PDFDocument(bytes);
  const t = doc.loadPage(0).toStructuredText().asText().trim();
  doc.destroy();
  return t;
}

describe('unlockPdf', () => {
  it('AES-128 (V=4/R=4, el caso ICBC) + password correcto → desencripta vía fallback mupdf', async () => {
    const enc = makePdf('encrypt=aes-128,user-password=secret');
    expect(needsPassword(enc)).toBe(true); // sanity: el fixture realmente quedó cifrado

    const res = await unlockPdf(enc, 'secret');

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(needsPassword(res.bytes)).toBe(false); // ya no está cifrado
      expect(readText(res.bytes)).toContain('MOVIMIENTOS 123'); // contenido legible
    }
  });

  it('AES-256 (V=5/R=6) + password correcto → desencripta (pdf-decrypt lo soporta)', async () => {
    const enc = makePdf('encrypt=aes-256,user-password=secret');

    const res = await unlockPdf(enc, 'secret');

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(needsPassword(res.bytes)).toBe(false);
      expect(readText(res.bytes)).toContain('MOVIMIENTOS 123');
    }
  });

  it('contraseña incorrecta → ok:false wrong_password (no manda bytes cifrados al LLM)', async () => {
    const enc = makePdf('encrypt=aes-128,user-password=secret');

    const res = await unlockPdf(enc, 'contraseña-mala');

    expect(res).toEqual({ ok: false, reason: 'wrong_password' });
  });

  it('PDF sin encriptar → devuelve bytes usables tal cual', async () => {
    const plain = makePdf(''); // sin encriptación

    const res = await unlockPdf(plain, 'password-irrelevante');

    expect(res.ok).toBe(true);
    if (res.ok) expect(readText(res.bytes)).toContain('MOVIMIENTOS 123');
  });

  it('bytes que no son un PDF → ok:false unsupported', async () => {
    const res = await unlockPdf(new Uint8Array([1, 2, 3, 4, 5]), 'x');

    expect(res).toEqual({ ok: false, reason: 'unsupported' });
  });
});

describe('unlockPdfForImport', () => {
  it('PDF con /Encrypt pero SIN user-password (solo owner) y sin contraseña configurada → lo desencripta', async () => {
    // El caso que la API de Anthropic rechaza con 400 "password protected" aunque el PDF
    // se abra sin pedir nada. Antes ni se intentaba desbloquear si no había contraseña.
    const enc = makePdf('encrypt=aes-128,owner-password=solo-owner');
    expect(needsPassword(enc)).toBe(false); // sanity: abre sin contraseña...

    const res = await unlockPdfForImport(enc, null);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(readText(res.bytes)).toContain('MOVIMIENTOS 123');
    }
  });

  it('PDF con user-password y SIN contraseña configurada → locked_no_password (error accionable, no al LLM)', async () => {
    const enc = makePdf('encrypt=aes-128,user-password=secret');

    const res = await unlockPdfForImport(enc, null);

    expect(res).toEqual({ ok: false, reason: 'locked_no_password' });
  });

  it('PDF con user-password y contraseña configurada incorrecta → wrong_password', async () => {
    const enc = makePdf('encrypt=aes-128,user-password=secret');

    const res = await unlockPdfForImport(enc, 'contraseña-mala');

    expect(res).toEqual({ ok: false, reason: 'wrong_password' });
  });

  it('PDF con user-password y contraseña correcta → desencripta', async () => {
    const enc = makePdf('encrypt=aes-128,user-password=secret');

    const res = await unlockPdfForImport(enc, 'secret');

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(needsPassword(res.bytes)).toBe(false);
      expect(readText(res.bytes)).toContain('MOVIMIENTOS 123');
    }
  });

  it('PDF sin encriptar y sin contraseña → pasa derecho', async () => {
    const plain = makePdf('');

    const res = await unlockPdfForImport(plain, null);

    expect(res.ok).toBe(true);
    if (res.ok) expect(readText(res.bytes)).toContain('MOVIMIENTOS 123');
  });

  it('archivo que ni mupdf abre y SIN contraseña → no es fatal: sigue con los bytes originales', async () => {
    // Leniencia deliberada: sin contraseña declarada no podemos afirmar que esté cifrado,
    // así que no rompemos imports que hoy funcionan; que el parser intente.
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);

    const res = await unlockPdfForImport(garbage, null);

    expect(res).toEqual({ ok: true, bytes: garbage });
  });

  it('archivo que ni mupdf abre y CON contraseña → unsupported (el usuario dijo que está protegido)', async () => {
    const res = await unlockPdfForImport(new Uint8Array([1, 2, 3, 4, 5]), 'x');

    expect(res).toEqual({ ok: false, reason: 'unsupported' });
  });
});

describe('stripPdfPreamble', () => {
  const header = (): number[] => [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x36]; // "%PDF-1.6"

  it('REGRESIÓN: descarta el salto de línea suelto de los extractos HSBC US', () => {
    // Caso real: byte 0 = 0x0A y el header arranca en el offset 1. mupdf y
    // pdf-parse lo abren igual, pero la API de Anthropic lo rechaza con
    // "The PDF specified was not valid".
    const withPreamble = new Uint8Array([0x0a, ...header()]);
    const out = stripPdfPreamble(withPreamble);
    expect(out[0]).toBe(0x25);
    expect(Array.from(out)).toEqual(header());
  });

  it('deja intacto un PDF que ya arranca en %PDF', () => {
    const clean = new Uint8Array(header());
    const out = stripPdfPreamble(clean);
    expect(out).toBe(clean); // misma referencia: no copia de más
  });

  it('tolera varios bytes de preámbulo', () => {
    const out = stripPdfPreamble(new Uint8Array([0x0d, 0x0a, 0x20, ...header()]));
    expect(Array.from(out)).toEqual(header());
  });

  it('no toca un archivo sin header %PDF', () => {
    // Si no es un PDF, no hay nada que sanear con confianza: se devuelve igual
    // y que falle más adelante con su propio error.
    const notPdf = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]); // ZIP
    expect(stripPdfPreamble(notPdf)).toBe(notPdf);
  });

  it('no busca el header más allá del margen tolerado', () => {
    // 2000 bytes de basura y recién después "%PDF": eso no es un PDF con
    // preámbulo, es otra cosa que lo contiene. No se recorta.
    const far = new Uint8Array([...new Array<number>(2000).fill(0x20), ...header()]);
    expect(stripPdfPreamble(far)).toBe(far);
  });

  it('no rompe con archivos más cortos que el header', () => {
    const tiny = new Uint8Array([0x25, 0x50]);
    expect(stripPdfPreamble(tiny)).toBe(tiny);
    expect(stripPdfPreamble(new Uint8Array())).toEqual(new Uint8Array());
  });
});

describe('unlockPdfForImport — saneo del preámbulo', () => {
  it('desbloquea un PDF válido que venía con un byte de más adelante', async () => {
    const pdf = makePdf('');
    const dirty = new Uint8Array([0x0a, ...pdf]);
    const res = await unlockPdfForImport(dirty, null);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.bytes[0]).toBe(0x25);
  });
});
