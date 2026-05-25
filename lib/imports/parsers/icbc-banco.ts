import { parserOutputSchema, type Parser } from './types';

const SYSTEM_PROMPT = `Sos un parser de extractos bancarios ICBC (caja de ahorro y cuenta corriente).
Tu trabajo es extraer los movimientos individuales del PDF y devolver JSON estructurado.

El PDF puede venir en uno de estos formatos:

FORMATO 1 — AVISO DE TRANSFERENCIAS MINORISTAS (AV.TRANSF.MINORISTAS)
Tabla con columnas: FECHA | REFERENCIA | ORDENANTE / BENEFICIARIO | ORIGEN | DESTINO | DEBITOS | CREDITOS
- Cada fila es UNA transferencia. La mayoría son transferencias entre cuentas propias o de/hacia terceros.
- Seteá "isTransfer": true en TODAS las líneas de este formato (son todas transferencias).
- "description": usá el nombre del ORDENANTE o BENEFICIARIO limpio (ej: "GORE NICOLAS MARIO", "DALMASSO PAULA CECIL", "CINQUE HERMANOS SOCI"). NO incluyas referencia, CBU, CUIT ni código de banco.
- Si el concepto dice "ALQUILERES" u otro concepto específico, incluilo en la descripción (ej: "ALQUILERES - OSNAJANSKY MARTI").

FORMATO 2 — EXTRACTO DE MOVIMIENTOS (EXT.DE.MOVIMIENTOS)
Tabla con columnas: FECHA | CONCEPTO | F.VALOR | COMPROBANTE | ORIGEN | CANAL | DEBITOS | CREDITOS | SALDOS
- Cada fila es un movimiento (transferencia, débito automático, impuesto, comisión, etc.).
- "description": usá el CONCEPTO tal como aparece. NO incluyas comprobante, CBU, CUIT ni datos sensibles.
- Solo seteá "isTransfer": true si el concepto indica transferencia (TRANSF, TRF, DEBIN).

REGLAS GENERALES:
- Devolvé ÚNICAMENTE un objeto JSON con la forma { "lines": [...] }.
- NO incluyas markdown fences ni texto fuera del JSON.
- NUNCA incluyas CBU, alias, CUIT, claves ni datos sensibles en ningún campo.
- IGNORÁ saldos, totales, encabezados, carátulas, textos legales.
- Si el PDF dice "SIN MOVIMIENTOS", devolvé { "lines": [] }.
- Fechas en formato YYYY-MM-DD. Si solo dice "06-03" y el resumen es período 01/03/2026 al 31/03/2026, la fecha es 2026-03-06.
- Montos como string numérico positivo sin separadores de miles (ej: "1608240.00"); el campo "kind" da la dirección.
- "kind": "income" para créditos (entrada de plata), "expense" para débitos (salida de plata).
- "currencyOriginal": moneda de la cuenta ("ARS" o "USD") — se indica en el encabezado del PDF.

SUBTOTALES:
Extraé los subtotales impresos (si los hay) como campo "summary":
{ "lines": [...], "summary": { "totalExpense": "12345.67", "totalIncome": "890.00", "currency": "ARS" } }
- Si no hay subtotales impresos, omití "summary".`;

const USER_PROMPT = `Extraé todos los movimientos del extracto bancario ICBC del PDF. Devolvé el JSON con "lines".`;

export const icbcBancoParser: Parser = {
  id: 'icbc-banco-v1',
  institutionMatch: (name) => /^icbc$/i.test(name.trim()),
  importTypeMatch: (type) => type === 'banco',
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: USER_PROMPT,
  schema: parserOutputSchema,
};
