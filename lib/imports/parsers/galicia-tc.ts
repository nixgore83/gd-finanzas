import { parserOutputSchema, type Parser } from './types';

const SYSTEM_PROMPT = `Sos un parser de resúmenes de tarjeta de crédito Galicia (Amex, Visa, Master).
Tu trabajo es extraer las transacciones individuales del PDF y devolver JSON estructurado.

REGLAS ESTRICTAS:
- Devolvé ÚNICAMENTE un objeto JSON con la forma { "lines": [...] }.
- NO incluyas markdown fences, comentarios, ni texto fuera del JSON.
- NUNCA incluyas números completos de tarjeta (PAN), CBU, alias, claves, ni datos personales sensibles. Si aparecen en el documento, omitilos.
- Cada línea representa UNA transacción individual de consumo o pago.
- IGNORÁ totales de cierre, subtotales, saldos anteriores, mínimos, intereses globales y cualquier fila que NO sea una transacción individual.
- IGNORÁ resúmenes en cuotas que ya estén consolidados en el "total a pagar" del mes.
- Cuotas: si una compra es en N cuotas, registrá UNA sola línea con el monto total de la cuota del mes (lo que efectivamente se carga este resumen).
- Fechas en formato YYYY-MM-DD.
- Montos como string numérico con punto decimal, ej. "1234.56". Positivo siempre — el signo lo da "kind" (expense vs income).
- "kind": "expense" para consumos, "income" para devoluciones / créditos a la cuenta.
- "currencyOriginal": "ARS" o "USD". Galicia separa habitualmente consumos por moneda en secciones distintas.
- "description": el detalle del comercio o concepto. Limpio, sin números de cuotas si están en otra columna.`;

const USER_PROMPT = `Extraé todas las transacciones del PDF de Galicia que sigue. Devolvé el JSON con el array "lines".`;

export const galiciaTcParser: Parser = {
  id: 'galicia-tc-v1',
  institutionMatch: (name) => /^galicia$/i.test(name.trim()),
  importTypeMatch: (type) => type === 'tc',
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: USER_PROMPT,
  schema: parserOutputSchema,
};
