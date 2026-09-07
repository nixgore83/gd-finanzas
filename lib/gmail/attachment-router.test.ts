import { describe, it, expect } from 'vitest';
import * as mupdf from 'mupdf';
import {
  routeAttachment,
  accountNumberSuffix,
  filenameSuffix,
  type RoutableAccount,
} from './attachment-router';

// Genera un PDF de 1 página con el texto dado, opcionalmente encriptado.
// `encryptOption` es la cadena de opciones de mupdf (ej. "encrypt=aes-128,user-password=x").
// NO usa datos reales: el contenido es un literal fijo por test.
function makePdf(text: string, encryptOption = ''): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font('Times-Roman'));
  const resources = doc.newDictionary();
  const fontDict = doc.newDictionary();
  fontDict.put('F1', font);
  resources.put('Font', fontDict);
  const page = doc.addPage(
    [0, 0, 400, 150],
    0,
    resources,
    `BT /F1 14 Tf 20 100 Td (${text}) Tj ET`,
  );
  doc.insertPage(-1, page);
  const view = doc.saveToBuffer(encryptOption).asUint8Array();
  const copy = new Uint8Array(view); // copiar fuera de la memoria WASM antes de destroy()
  doc.destroy();
  return copy;
}

function account(over: Partial<RoutableAccount> & { id: string }): RoutableAccount {
  return {
    name: '',
    type: 'bank_savings',
    cardBrand: null,
    currencyDefault: 'ARS',
    institutionId: 'inst-icbc',
    accountNumber: null,
    pdfPassword: null,
    ...over,
  };
}

// Las 3 cuentas ICBC que comparten el label "ICBC-Cuentas".
const CAJA_USD = account({
  id: 'caja-usd',
  type: 'bank_savings',
  currencyDefault: 'USD',
  accountNumber: '0905/11102104/13', // → 0413
});
const CAJA_ARS = account({
  id: 'caja-ars',
  type: 'bank_savings',
  currencyDefault: 'ARS',
  accountNumber: '0926/01109094/30', // → 9430
});
const CTA_CTE = account({
  id: 'cta-cte',
  type: 'bank_checking',
  currencyDefault: 'ARS',
  accountNumber: '0905/02100757/27', // → 5727
});
const GROUP = [CAJA_USD, CAJA_ARS, CTA_CTE];

describe('accountNumberSuffix', () => {
  it('arma el sufijo con los últimos 2 dígitos de la cuenta + la sucursal', () => {
    expect(accountNumberSuffix('0905/11102104/13')).toBe('0413');
    expect(accountNumberSuffix('0926/01109094/30')).toBe('9430');
    expect(accountNumberSuffix('0905/02100757/27')).toBe('5727');
  });

  it('devuelve null cuando el número no tiene la forma esperada', () => {
    expect(accountNumberSuffix(null)).toBeNull();
    expect(accountNumberSuffix('')).toBeNull();
    expect(accountNumberSuffix('...9616800')).toBeNull(); // formato Galicia
    expect(accountNumberSuffix('0905/11102104')).toBeNull(); // sin sucursal
    expect(accountNumberSuffix('0905/ABC/13')).toBeNull(); // no numérico
  });
});

describe('filenameSuffix', () => {
  it('extrae el sufijo de PDF y CSV, sin importar el case', () => {
    expect(filenameSuffix('AV.TRANSF.MINORISTAS-0413.PDF')).toBe('0413');
    expect(filenameSuffix('EXT.DE.MOVIMIENTOS-5727.pdf')).toBe('5727');
    expect(filenameSuffix('movimientos-9430.csv')).toBe('9430');
  });

  it('devuelve null cuando no hay sufijo', () => {
    expect(filenameSuffix('EResumenMaster.PDF')).toBeNull();
    expect(filenameSuffix('2026-07-14_Statement.pdf')).toBeNull();
  });
});

describe('routeAttachment', () => {
  it('rutea el aviso de transferencias de la caja USD por el sufijo, sin abrir el PDF', async () => {
    // Bytes que NO son un PDF válido: si igual rutea, es prueba de que no lo abrió.
    const notAPdf = new Uint8Array([1, 2, 3, 4]);
    const res = await routeAttachment(notAPdf, 'AV.TRANSF.MINORISTAS-0413.PDF', GROUP);
    expect(res?.account.id).toBe('caja-usd');
    expect(res?.bytes).toBe(notAPdf);
  });

  it('rutea el extracto de movimientos de la cuenta corriente por el sufijo', async () => {
    const pdf = makePdf('EXTRACTO');
    const res = await routeAttachment(pdf, 'EXT.DE.MOVIMIENTOS-5727.PDF', GROUP);
    expect(res?.account.id).toBe('cta-cte');
  });

  it('descarta el aviso de transferencias de la caja ARS 0926', async () => {
    // Decisión Nico 2026-08-25: la 0926 se alimenta del CSV, no de los avisos.
    const res = await routeAttachment(makePdf('AVISO'), 'AV.TRANSF.MINORISTAS-9430.PDF', GROUP);
    expect(res).toBeNull();
  });

  it('descarta carátulas y avisos de falta de fondos', async () => {
    const pdf = makePdf('CAJA DE AHORRO EN DOLARES');
    expect(await routeAttachment(pdf, 'CARATULA-0413.PDF', GROUP)).toBeNull();
    expect(await routeAttachment(pdf, 'AV. FALTA DE FON-9430.PDF', GROUP)).toBeNull();
  });

  it('cae al ruteo por contenido cuando el filename no trae sufijo', async () => {
    const pdf = makePdf('CAJA DE AHORRO EN DOLARES');
    const res = await routeAttachment(pdf, 'extracto.pdf', GROUP);
    expect(res?.account.id).toBe('caja-usd');
  });

  it('desencripta AES-128 (el caso ICBC) para poder rutear por contenido', async () => {
    // Este es el bug de fondo: el router usaba pdf-decrypt directo, que rechaza
    // AES-128 V=4/R=4, y seguía con los bytes cifrados → texto ilegible → descarte.
    const pdf = makePdf('CAJA DE AHORRO EN DOLARES', 'encrypt=aes-128,user-password=secret');
    const accounts = GROUP.map((a) => (a.id === 'caja-ars' ? { ...a, pdfPassword: 'secret' } : a));
    const res = await routeAttachment(pdf, 'extracto.pdf', accounts);
    expect(res?.account.id).toBe('caja-usd');
  });

  it('descarta extractos sin movimientos', async () => {
    const pdf = makePdf('CAJA DE AHORRO EN DOLARES - SIN MOVIMIENTOS');
    expect(await routeAttachment(pdf, 'extracto.pdf', GROUP)).toBeNull();
  });

  it('devuelve null si no hay sufijo conocido ni contenido reconocible', async () => {
    expect(await routeAttachment(makePdf('OTRA COSA'), 'cualquiera.pdf', GROUP)).toBeNull();
    // Sufijo que no corresponde a ninguna cuenta del grupo, contenido ilegible.
    expect(
      await routeAttachment(new Uint8Array([9, 9]), 'EXT.DE.MOVIMIENTOS-1111.PDF', GROUP),
    ).toBeNull();
  });
});
