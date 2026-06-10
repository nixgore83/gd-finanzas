import {
  CsvFormatError,
  parserOutputSchema,
  type ParsedTxLine,
  type Parser,
  type ParserOutput,
} from './types';

/**
 * Parser de movimientos de caja de ahorro de Banco Galicia.
 *
 * Caso primario: el export **XLSX** de homebanking (`parseXlsx`, determinístico, sin LLM).
 * Formato (headerless en las primeras filas): encabezado banco/cuenta/intervalo + fila de
 * columnas `Fecha | Movimiento | Débito | Crédito | Saldo Parcial | Comentarios`; datos con
 * `Fecha = DD/MM/YYYY`, montos es-AR (`-99.235,24`, débito negativo) y `Movimiento` multilínea
 * (concepto + contraparte: `CU <cuit>`, CBU de 22 dígitos, nombre, alias, descripción).
 *
 * El `systemPrompt`/`userPrompt` quedan como fallback por si llega un PDF de Galicia banco.
 */

// DNIs de los miembros del household (Nico / Pau). Una transferencia cuya contraparte tenga
// uno de estos en su CUIT es una transferencia entre cuentas del household (no ingreso/gasto).
// Limitación conocida: es data del household en código; mejora futura = guardarla en config/DB.
const HOUSEHOLD_DNIS = ['30555106', '28864311'];

const SYSTEM_PROMPT = `Sos un parser de extractos de caja de ahorro de Banco Galicia.
Extraé los movimientos y devolvé JSON { "lines": [...] }.
- "date" en formato YYYY-MM-DD. En Galicia las fechas vienen DD/MM/YYYY.
- "amountOriginal": string numérico positivo sin separadores de miles; "kind" da la dirección
  ("expense" para débitos, "income" para créditos). Montos en formato es-AR (coma decimal).
- "description": el concepto limpio (ej "TRANSF. CTAS PROPIAS", "PAGO TARJETA VISA").
- "counterparty": si el movimiento identifica una contraparte, extraé { name, cuil, cbu, alias }.
  No mezcles CUIT/CBU en "description".
- "currencyOriginal": "ARS" o "USD" según la cuenta.
- NUNCA incluyas claves ni credenciales.`;
const USER_PROMPT = `Extraé todos los movimientos del extracto de Banco Galicia. Devolvé el JSON con "lines".`;

function parseEsArAmount(s: string): number {
  // "-99.235,24" -> -99235.24 ; "0,00" -> 0
  const t = (s || '').trim().replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function extractCounterparty(movLines: string[]): ParsedTxLine['counterparty'] {
  const rest = movLines.slice(1).map((l) => l.trim()).filter(Boolean);
  let cuil: string | undefined;
  let cbu: string | undefined;
  let name: string | undefined;
  for (const t of rest) {
    const mCu = t.match(/^CU\s+(\d{11})$/) || t.match(/^(\d{11})$/);
    if (mCu && !cuil) {
      cuil = mCu[1];
      continue;
    }
    if (/^\d{22}$/.test(t) && !cbu) {
      cbu = t;
      continue;
    }
    if (
      !name &&
      /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s.]+$/.test(t) &&
      t.split(/\s+/).length >= 2 &&
      !/BANCO|FIMA|OPERACION|VARIOS|PREMIUM|CLASE|GASTRONOM/i.test(t)
    ) {
      name = t;
    }
  }
  const cp: NonNullable<ParsedTxLine['counterparty']> = {};
  if (name) cp.name = name;
  if (cuil) cp.cuil = cuil;
  if (cbu) cp.cbu = cbu;
  return Object.keys(cp).length ? cp : undefined;
}

function classify(
  concept: string,
  cuil: string | undefined,
): { isTransfer: boolean; transferAccountName?: string; suggestedCategory?: string } {
  const u = concept.toUpperCase();
  const household = !!cuil && HOUSEHOLD_DNIS.some((d) => cuil.includes(d));

  if (/CTAS PROPIAS|CUENTA PROPIA/.test(u)) return { isTransfer: true };
  if (/FIMA/.test(u)) return { isTransfer: true, transferAccountName: 'Galicia Inversiones' };
  if (/^PAGO TARJETA AMEX/.test(u)) return { isTransfer: true, transferAccountName: 'Galicia Amex' };
  if (/^PAGO TARJETA VISA/.test(u)) return { isTransfer: true, transferAccountName: 'Galicia Visa' };
  if (/^PAGO TARJETA MASTER/.test(u)) return { isTransfer: true, transferAccountName: 'Galicia Master' };
  if (household) return { isTransfer: true };

  if (/^REINTEGRO PROMO/.test(u)) return { isTransfer: false, suggestedCategory: 'Otros ingresos' };
  if (/^INTERES/.test(u)) return { isTransfer: false, suggestedCategory: 'Intereses' };
  if (/^IVA\b|^COMISION/.test(u)) return { isTransfer: false, suggestedCategory: 'Gastos bancarios' };
  return { isTransfer: false };
}

function parseGaliciaBancoXlsx(rows: string[][], ctx: { currency: 'ARS' | 'USD' }): ParserOutput {
  const dataRows = rows.filter((r) => /^\d{2}\/\d{2}\/\d{4}$/.test((r[0] || '').trim()));
  const hasHeader = rows.some((r) =>
    r.some((c) => /movimiento/i.test(c)) && r.some((c) => /d[ée]bito/i.test(c)),
  );
  if (!hasHeader || dataRows.length === 0) {
    throw new CsvFormatError('no parece un export de Galicia banco (sin encabezado Movimiento/Débito)');
  }

  const lines: ParsedTxLine[] = [];
  for (const r of dataRows) {
    const [dd, mm, yyyy] = (r[0] ?? '').trim().split('/');
    const date = `${yyyy}-${mm}-${dd}`;
    const movLines = (r[1] || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const concept = movLines[0] || '';
    if (!concept) continue;

    const deb = parseEsArAmount(r[2] || ''); // negativo
    const cred = parseEsArAmount(r[3] || ''); // positivo
    let kind: 'income' | 'expense';
    let amount: number;
    if (deb < 0) {
      kind = 'expense';
      amount = Math.abs(deb);
    } else if (cred > 0) {
      kind = 'income';
      amount = cred;
    } else {
      continue;
    }

    const counterparty = extractCounterparty(movLines);
    const cls = classify(concept, counterparty?.cuil);

    lines.push({
      date,
      description: concept,
      amountOriginal: amount.toFixed(2),
      currencyOriginal: ctx.currency,
      kind,
      isTransfer: cls.isTransfer,
      isRefund: false,
      ...(cls.transferAccountName ? { transferAccountName: cls.transferAccountName } : {}),
      ...(cls.suggestedCategory ? { suggestedCategory: cls.suggestedCategory } : {}),
      ...(counterparty ? { counterparty } : {}),
    });
  }

  return { lines };
}

export const galiciaBancoParser: Parser = {
  id: 'galicia-banco-v1',
  institutionMatch: (name) => /galicia/i.test(name.trim()),
  importTypeMatch: (type) => type === 'banco',
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: USER_PROMPT,
  schema: parserOutputSchema,
  parseXlsx: parseGaliciaBancoXlsx,
};
