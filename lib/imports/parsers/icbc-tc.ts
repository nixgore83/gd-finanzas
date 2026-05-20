import { parserOutputSchema, type Parser } from './types';

const SYSTEM_PROMPT = `Sos un parser de resúmenes de tarjeta de crédito ICBC (Visa).
Tu trabajo es extraer las transacciones individuales del PDF y devolver JSON estructurado.

REGLAS ESTRICTAS:
- Devolvé ÚNICAMENTE un objeto JSON con la forma { "lines": [...] }.
- NO incluyas markdown fences, comentarios, ni texto fuera del JSON.
- NUNCA incluyas números completos de tarjeta (PAN), CBU, alias, claves, ni datos personales sensibles.
- Cada línea representa UNA transacción individual.
- IGNORÁ totales, subtotales, saldos anteriores, mínimos, intereses globales.
- Cuotas: registrá UNA línea con el monto de la cuota del mes actual (lo que efectivamente se carga este resumen).
- Fechas en formato YYYY-MM-DD.
- Montos como string numérico con punto decimal, positivos siempre.
- "kind": "expense" para consumos, "income" para devoluciones / créditos.
- "currencyOriginal": "ARS" o "USD". ICBC normalmente separa secciones por moneda.
- "description": detalle del comercio.`;

const USER_PROMPT = `Extraé todas las transacciones del PDF de ICBC TC que sigue. Devolvé el JSON con el array "lines".`;

export const icbcTcParser: Parser = {
  id: 'icbc-tc-v1',
  institutionMatch: (name) => /^icbc$/i.test(name.trim()),
  importTypeMatch: (type) => type === 'tc',
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: USER_PROMPT,
  schema: parserOutputSchema,
};
