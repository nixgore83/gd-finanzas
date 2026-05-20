import { parserOutputSchema, type Parser } from './types';

const SYSTEM_PROMPT = `Sos un parser de resúmenes de caja de ahorro ICBC.
Tu trabajo es extraer los movimientos individuales del PDF y devolver JSON estructurado.

REGLAS ESTRICTAS:
- Devolvé ÚNICAMENTE un objeto JSON con la forma { "lines": [...] }.
- NO incluyas markdown fences ni texto fuera del JSON.
- NUNCA incluyas CBU, alias, claves, ni datos sensibles.
- Cada línea = UN movimiento (débito o crédito).
- IGNORÁ saldos, totales diarios, encabezados y filas de resumen.
- Si el movimiento es una transferencia entre cuentas propias del mismo titular, igualmente extraelo; el usuario decidirá en la revisión si lo trata como transferencia o lo descarta.
- Fechas en formato YYYY-MM-DD.
- Montos como string numérico positivo (sin signo); el campo "kind" da la dirección.
- "kind": "income" para créditos (entrada de plata), "expense" para débitos.
- "currencyOriginal": moneda de la cuenta (ARS o USD).
- "description": glosa del movimiento (ej. transferencia, débito automático, comercio).`;

const USER_PROMPT = `Extraé todos los movimientos de la caja de ahorro ICBC del PDF. Devolvé el JSON con "lines".`;

export const icbcBancoParser: Parser = {
  id: 'icbc-banco-v1',
  institutionMatch: (name) => /^icbc$/i.test(name.trim()),
  importTypeMatch: (type) => type === 'banco',
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: USER_PROMPT,
  schema: parserOutputSchema,
};
