import {
  CsvFormatError,
  parserOutputSchema,
  type ParsedTxLine,
  type Parser,
  type ParserOutput,
} from './types';

const SYSTEM_PROMPT = `Sos un parser de extractos bancarios ICBC (caja de ahorro y cuenta corriente).
Tu trabajo es extraer los movimientos individuales del PDF y devolver JSON estructurado.

El PDF puede venir en uno de estos formatos:

FORMATO 1 — AVISO DE TRANSFERENCIAS MINORISTAS (AV.TRANSF.MINORISTAS)
Tabla con columnas: FECHA | REFERENCIA | ORDENANTE / BENEFICIARIO | ORIGEN | DESTINO | DEBITOS | CREDITOS
- Cada fila es UNA transferencia. La mayoría son transferencias entre cuentas propias o de/hacia terceros.
- Seteá "isTransfer": true en TODAS las líneas de este formato (son todas transferencias).
- "description": un concepto LIMPIO y corto. Si hay un concepto explícito (ej: "ALQUILERES"), usalo; si no, usá el nombre de la contraparte (ej: "Transf. de GORE NICOLAS"). NO metas CBU, CUIT, nro de cuenta ni referencia en la description.
- "counterparty": extraé acá los identificadores de la contraparte (ordenante o beneficiario):
  { "name": nombre tal cual (ej "GORE NICOLAS MARIO"), "accountRef": nro de cuenta de origen/destino si figura (ej "0926/01109094/30"), "cuil": CUIL/CUIT si figura, "cbu": CBU si figura, "alias": alias bancario si figura }.
  Incluí solo los campos que realmente aparezcan; omití los que no.

FORMATO 2 — EXTRACTO DE MOVIMIENTOS (EXT.DE.MOVIMIENTOS)
Tabla con columnas: FECHA | CONCEPTO | F.VALOR | COMPROBANTE | ORIGEN | CANAL | DEBITOS | CREDITOS | SALDOS
- Cada fila es un movimiento (transferencia, débito automático, impuesto, comisión, etc.).
- "description": usá el CONCEPTO de forma LIMPIA. Si el concepto trae embebido un nro de cuenta/CUIL/comprobante (ej "TRASP.DE 0926/01109094/30"), dejá en description solo la parte legible ("Trasp. de") y mové el identificador a "counterparty".
- "counterparty": si el movimiento es una transferencia/traspaso y se puede identificar la contraparte, extraé acá lo que figure:
  { "name", "accountRef", "cuil", "cbu", "alias" }. Incluí solo los campos presentes; si no hay contraparte identificable, omití "counterparty".
- Solo seteá "isTransfer": true si el concepto indica transferencia (TRANSF, TRF, TRASP, DEBIN).

REGLAS GENERALES:
- Devolvé ÚNICAMENTE un objeto JSON con la forma { "lines": [...] }.
- NO incluyas markdown fences ni texto fuera del JSON.
- Los identificadores de la contraparte (CBU, CUIT, nro de cuenta, alias) van EN EL CAMPO "counterparty", NUNCA mezclados en "description". No inventes datos: si un campo no aparece en el PDF, omitilo.
- NUNCA incluyas claves, contraseñas ni credenciales de acceso en ningún campo.
- IGNORÁ saldos, totales, encabezados, carátulas, textos legales.
- Si el PDF dice "SIN MOVIMIENTOS", devolvé { "lines": [] }.
- Fechas en formato YYYY-MM-DD. Si solo dice "06-03" y el resumen es período 01/03/2026 al 31/03/2026, la fecha es 2026-03-06.
- Montos como string numérico positivo sin separadores de miles (ej: "1608240.00"); el campo "kind" da la dirección.
- "kind": "income" para créditos (entrada de plata), "expense" para débitos (salida de plata).
- "currencyOriginal": moneda de la cuenta ("ARS" o "USD") — se indica en el encabezado del PDF.

SUBTOTALES:
Extraé los subtotales impresos (si los hay) como campo "summary":
{ "lines": [...], "summary": { "totalExpense": "12345.67", "totalIncome": "890.00", "currency": "ARS" } }
- Si no hay subtotales impresos, omití "summary".

CUENTA DEL EXTRACTO (encabezado):
Además de ignorar el encabezado para los movimientos, extraé el número de la cuenta PROPIA del extracto (la del titular, que figura en el encabezado del PDF — NO la contraparte de cada movimiento) como campo "statementAccount":
{ "lines": [...], "statementAccount": { "number": "0926/01109094/30", "holder": "GORE NICOLAS MARIO" } }
- "number": nº de cuenta tal cual aparece en el encabezado (sucursal/cuenta/dígito). Si no figura, omití "statementAccount".
- No lo confundas con el "accountRef" de la contraparte de un movimiento.`;

const USER_PROMPT = `Extraé todos los movimientos del extracto bancario ICBC del PDF. Devolvé el JSON con "lines".`;

/**
 * Clasifica un concepto de ICBC homebanking en hints de transferencia / categoría.
 * Codifica las reglas de negocio definidas con Nico (2026-06-10): los movimientos de
 * fondo común (FCI) y los pagos de tarjeta son TRANSFERENCIAS (no impactan ingreso/gasto),
 * y algunos conceptos sistemáticos tienen categoría obvia. El resto queda sin hint para
 * revisión humana. `transferAccountName` lo resuelve `parse-internal` a `transferAccountId`.
 */
function classifyIcbcConcept(desc: string): {
  isTransfer?: boolean;
  transferAccountName?: string;
  suggestedCategory?: string;
} {
  const d = desc.toUpperCase();
  // Transferencias (no son ingreso/gasto)
  if (/FCI/.test(d)) return { isTransfer: true, transferAccountName: 'ICBC Inversiones' };
  if (/^PAGO (TARJETA )?MASTERCARD/.test(d))
    return { isTransfer: true, transferAccountName: 'ICBC Master' };
  if (/^PAGO (TARJETA )?VISA/.test(d))
    return { isTransfer: true, transferAccountName: 'ICBC Visa' };
  // DEBIN preacordado contra el CUIT de Mercado Libre = fondeo de la billetera propia
  // (decisión Nico 2026-06-11)
  if (/^DEB\.? ?PREA\.? ?DEBIN\s*30703088534/.test(d))
    return { isTransfer: true, transferAccountName: 'Mercado Pago' };
  // Categorías sistemáticas
  if (/^IVA COM\. CUST\.|^COMISION CUSTODIA|^COM\. RECHAZO|^IMPUESTO AL VALOR AGREGADO/.test(d))
    return { suggestedCategory: 'Gastos bancarios' };
  if (/^LIQUIDACION DE INTERESES/.test(d)) return { suggestedCategory: 'Intereses' };
  if (/^REINTEGRO POR PROMOCION/.test(d)) return { suggestedCategory: 'Otros ingresos' };
  if (/^TRANS PAG SUEL/.test(d)) return { suggestedCategory: 'Sueldo' };
  if (/^EXT\. JUMBO|^CPA\. JUMBO/.test(d)) return { suggestedCategory: 'Supermercado' };
  return {};
}

/**
 * Parseo DETERMINÍSTICO del CSV de movimientos de ICBC homebanking (caja de ahorro / cc).
 * Formato real (headerless): `MM/DD/YY,CONCEPTO,DEBITO,CREDITO,` — débito y crédito son
 * mutuamente excluyentes (el otro es 0.0). Montos grandes vienen en notación científica
 * (`1.4090103E7`), que `Number(...).toFixed(2)` expande. Lanza `CsvFormatError` si el
 * texto no tiene este layout (→ fallback a LLM en parse-internal).
 */
function parseIcbcBancoCsv(text: string, ctx: { currency: 'ARS' | 'USD' }): ParserOutput {
  const lines: ParsedTxLine[] = [];
  let seenData = false;

  for (const raw of text.split(/\r?\n/)) {
    const row = raw.trim();
    if (!row) continue;
    const f = row.split(',');
    if (f.length < 4) continue;

    const dm = f[0]!.trim();
    if (!/^\d{2}\/\d{2}\/\d{2}$/.test(dm)) {
      // La 1ª fila de datos define el formato: si no es MM/DD/YY, no es este CSV.
      if (!seenData) throw new CsvFormatError('fila inicial no es MM/DD/YY (no es ICBC banco CSV)');
      continue; // fila rara en medio del archivo → saltear
    }
    seenData = true;

    const [mm, dd, yy] = dm.split('/');
    const date = `20${yy}-${mm}-${dd}`;
    const description = f[1]!.trim();
    if (!description) continue;

    const deb = Number(f[2]);
    const cred = Number(f[3]);
    if (!Number.isFinite(deb) || !Number.isFinite(cred)) continue;

    let kind: 'income' | 'expense';
    let amount: number;
    if (deb > 0) {
      kind = 'expense';
      amount = deb;
    } else if (cred > 0) {
      kind = 'income';
      amount = cred;
    } else {
      continue; // ambos 0 → no es un movimiento
    }

    const concept = classifyIcbcConcept(description);
    lines.push({
      date,
      description,
      amountOriginal: amount.toFixed(2), // expande notación científica + normaliza 2 dec
      currencyOriginal: ctx.currency,
      kind,
      isTransfer: concept.isTransfer ?? false,
      isRefund: false,
      ...(concept.transferAccountName ? { transferAccountName: concept.transferAccountName } : {}),
      ...(concept.suggestedCategory ? { suggestedCategory: concept.suggestedCategory } : {}),
    });
  }

  if (!seenData) throw new CsvFormatError('sin filas de movimiento reconocibles');
  return { lines };
}

export const icbcBancoParser: Parser = {
  id: 'icbc-banco-v1',
  institutionMatch: (name) => /^icbc$/i.test(name.trim()),
  importTypeMatch: (type) => type === 'banco',
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: USER_PROMPT,
  schema: parserOutputSchema,
  parseCsv: parseIcbcBancoCsv,
};
