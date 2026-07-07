import {
  CsvFormatError,
  parserOutputSchema,
  type ImportSummary,
  type ParsedTxLine,
  type Parser,
  type ParserOutput,
} from './types';

/**
 * Parser del estado de cuenta (billetera / dinero en cuenta) de Mercado Pago.
 *
 * Caso primario: el **Excel** que MP exporta como "estado de cuenta"
 * (`account_statement-<uuid>.xlsx`), determinístico y sin LLM. Formato:
 *   - Fila resumen: `INITIAL_BALANCE | CREDITS | DEBITS | FINAL_BALANCE`.
 *   - Fila header de movimientos: `RELEASE_DATE | TRANSACTION_TYPE | REFERENCE_ID |
 *     TRANSACTION_NET_AMOUNT | PARTIAL_BALANCE`.
 *   - Datos: fecha `DD-MM-YYYY`, monto es-AR CON signo (negativo = egreso), la contraparte
 *     va embebida en `TRANSACTION_TYPE` (ej. "Transferencia enviada Julian Ezequiel Caballero").
 *
 * El `systemPrompt`/`userPrompt` quedan como fallback por si llega un PDF del resumen MP.
 */

// Nombres de los miembros del household (Nico / Pau) tal como aparecen en las transferencias
// de Mercado Pago. Una "Transferencia enviada/recibida" cuya contraparte sea uno de ellos es una
// transferencia entre cuentas propias del household (no ingreso/gasto). Misma limitación conocida
// que galicia-banco (HOUSEHOLD_DNIS): es data del household en código; mejora futura = config/DB.
const HOUSEHOLD_NAMES = ['nicolas mario gore', 'paula cecilia dalmasso'];

// Nombre de la cuenta TC de Mercado Pago (para resolver el pago automático como transfer propia).
const MP_TC_ACCOUNT_NAME = 'Mercado Pago Master';

const SYSTEM_PROMPT = `Sos un parser del estado de cuenta (dinero en cuenta / billetera) de Mercado Pago.
Extraé TODOS los movimientos y devolvé JSON { "lines": [...], "summary": {...} }.

CAMPOS OBLIGATORIOS POR LÍNEA:
- "date": fecha en formato YYYY-MM-DD (en MP las fechas vienen DD-MM-YYYY).
- "description": el tipo de movimiento tal cual (ej "Rendimientos", "Transferencia enviada Juan Perez",
  "Ingreso de dinero", "Pago de servicio ARCA", "Pago automático Tarjeta de crédito").
- "amountOriginal": string numérico POSITIVO con punto decimal; "kind" da la dirección.
- "currencyOriginal": "ARS" o "USD" según la cuenta.
- "kind": "expense" para egresos (monto negativo en el extracto) o "income" para ingresos (positivo).

REGLAS:
- Montos en formato es-AR: "3.306.391,65" → "3306391.65". El signo del extracto define kind (negativo → expense).
- "counterparty": en "Transferencia enviada/recibida <Nombre>" extraé { "name": "<Nombre>" }. Nunca mezcles
  CBU/CUIT/alias/claves en "description"; si aparecen, van en counterparty (accountRef/cuil/cbu/alias).
- IGNORÁ filas de saldo (INITIAL_BALANCE/FINAL_BALANCE/PARTIAL_BALANCE) y encabezados: NO son movimientos.
- Una línea por movimiento. Devolvé ÚNICAMENTE el JSON, sin markdown fences ni texto extra.

SUMMARY: usá los totales impresos del resumen — "totalIncome" = CREDITS, "totalExpense" = |DEBITS|,
"currency" = moneda de la cuenta. Si no hay, omití "summary".`;

const USER_PROMPT = `Extraé todos los movimientos del estado de cuenta de Mercado Pago que sigue. Devolvé el JSON con "lines" y "summary".`;

/** "3.306.391,65" → 3306391.65 ; "-5.000,00" → -5000 ; "0,00" → 0 */
function parseEsArAmount(s: string): number {
  const t = (s || '').trim().replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

type Classification = {
  isTransfer: boolean;
  transferAccountName?: string;
  suggestedCategory?: string;
  counterpartyName?: string;
};

/**
 * Clasifica un movimiento por su `TRANSACTION_TYPE`. Decide si es transferencia entre cuentas
 * propias (neutra), y hints de cuenta destino / categoría / contraparte. Lo que quede sin
 * resolver (transfer sin cuenta match) se completa en la revisión humana.
 */
function classify(type: string): Classification {
  const t = type.trim();
  const u = t.toUpperCase();

  // Transferencias: la contraparte va embebida ("Transferencia enviada/recibida <Nombre>").
  const mTransfer = t.match(/^Transferencia\s+(?:enviada|recibida)\s+(.+)$/i);
  if (mTransfer) {
    const name = mTransfer[1]!.trim();
    // Contraparte del household (Nico/Pau) → transferencia entre cuentas propias (neutra).
    // Tercero → NO es transfer: es gasto/ingreso real (el signo define la dirección).
    const household = HOUSEHOLD_NAMES.includes(normalizeName(name));
    return { isTransfer: household, counterpartyName: name };
  }

  // Pago automático de la TC de MP → transferencia a la cuenta TC propia.
  if (/PAGO\s+AUTOM[ÁA]TICO\s+TARJETA\s+DE\s+CR[ÉE]DITO/.test(u)) {
    return { isTransfer: true, transferAccountName: MP_TC_ACCOUNT_NAME };
  }

  // Movimientos hacia inversiones MP: no hay cuenta de inversiones modelada (decisión Nico) →
  // transferencia saliente sin parear, a resolver en revisión.
  if (/^INVERSI[ÓO]N/.test(u)) {
    return { isTransfer: true };
  }

  // "Ingreso de dinero": sin contraparte, suele fondear pagos desde cuentas propias →
  // transferencia entrante a parear en revisión (decisión Nico 2026-07-07).
  if (/^INGRESO\s+DE\s+DINERO/.test(u)) {
    return { isTransfer: true };
  }

  // Rendimientos de la cuenta remunerada (Mercado Fondo) → ingreso por intereses.
  if (/^RENDIMIENTOS/.test(u)) {
    return { isTransfer: false, suggestedCategory: 'Intereses' };
  }

  // Pago de impuestos ARCA (ex-AFIP).
  if (/^PAGO\s+DE\s+SERVICIO\s+ARCA/.test(u)) {
    return { isTransfer: false, suggestedCategory: 'Impuestos' };
  }

  return { isTransfer: false };
}

function extractSummary(rows: string[][], ctx: { currency: 'ARS' | 'USD' }): ImportSummary | undefined {
  const hIdx = rows.findIndex(
    (r) => r.some((c) => /CREDITS/i.test(c)) && r.some((c) => /DEBITS/i.test(c)),
  );
  if (hIdx === -1) return undefined;
  const header = (rows[hIdx] ?? []).map((c) => c.trim().toUpperCase());
  const vals = rows[hIdx + 1];
  if (!vals) return undefined;

  const ci = header.indexOf('CREDITS');
  const di = header.indexOf('DEBITS');
  const summary: ImportSummary = { currency: ctx.currency };
  if (ci >= 0) summary.totalIncome = Math.abs(parseEsArAmount(vals[ci] ?? '')).toFixed(2);
  if (di >= 0) summary.totalExpense = Math.abs(parseEsArAmount(vals[di] ?? '')).toFixed(2);
  return summary;
}

function parseMercadoPagoBancoXlsx(
  rows: string[][],
  ctx: { currency: 'ARS' | 'USD' },
): ParserOutput {
  const hasHeader = rows.some(
    (r) => r.some((c) => /RELEASE_DATE/i.test(c)) && r.some((c) => /TRANSACTION_TYPE/i.test(c)),
  );
  const dataRows = rows.filter((r) => /^\d{2}-\d{2}-\d{4}$/.test((r[0] || '').trim()));
  if (!hasHeader || dataRows.length === 0) {
    throw new CsvFormatError(
      'no parece un estado de cuenta de Mercado Pago (sin header RELEASE_DATE/TRANSACTION_TYPE)',
    );
  }

  const lines: ParsedTxLine[] = [];
  for (const r of dataRows) {
    const [dd, mm, yyyy] = (r[0] ?? '').trim().split('-');
    const date = `${yyyy}-${mm}-${dd}`;
    const type = (r[1] || '').trim();
    if (!type) continue;

    const net = parseEsArAmount(r[3] || ''); // TRANSACTION_NET_AMOUNT, con signo
    if (net === 0) continue; // sin monto → no es movimiento contable
    const kind: 'income' | 'expense' = net > 0 ? 'income' : 'expense';

    const cls = classify(type);

    const line: ParsedTxLine = {
      date,
      description: type, // se mantiene completo (incluye el nombre) para no colisionar en dedup
      amountOriginal: Math.abs(net).toFixed(2),
      currencyOriginal: ctx.currency,
      kind,
      isTransfer: cls.isTransfer,
      isRefund: false,
    };
    if (cls.transferAccountName) line.transferAccountName = cls.transferAccountName;
    if (cls.suggestedCategory) line.suggestedCategory = cls.suggestedCategory;
    if (cls.counterpartyName) line.counterparty = { name: cls.counterpartyName };
    lines.push(line);
  }

  const summary = extractSummary(rows, ctx);
  return summary ? { lines, summary } : { lines };
}

export const mercadoPagoBancoParser: Parser = {
  id: 'mercado-pago-banco-v1',
  institutionMatch: (name) => /^mercado\s?pago$/i.test(name.trim()),
  importTypeMatch: (type) => type === 'banco',
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: USER_PROMPT,
  schema: parserOutputSchema,
  parseXlsx: parseMercadoPagoBancoXlsx,
};
