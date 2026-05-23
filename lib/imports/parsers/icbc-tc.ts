import { parserOutputSchema, type Parser } from './types';

const SYSTEM_PROMPT = `Sos un parser de resúmenes de tarjeta de crédito ICBC (Visa o Mastercard).
Tu trabajo es extraer TODAS las transacciones individuales del PDF y devolver JSON estructurado.

El resumen ICBC tiene estas secciones típicas:
- "DETALLE DEL MES" con columnas: FECHA, Detalle de Cargos y Ajustes, NRO CUPON, PESOS, DOLARES
- A veces continúa en la página siguiente con formato tabular compacto (fecha DD-MMM-YY, descripción, número, monto).
- Puede tener secciones separadas para pesos y dólares.

REGLAS ESTRICTAS:
- Devolvé ÚNICAMENTE un objeto JSON con la forma { "lines": [...] }.
- NO incluyas markdown fences, comentarios, ni texto fuera del JSON.
- NUNCA incluyas números completos de tarjeta (PAN), CBU, alias, claves, ni datos personales sensibles.
- Extraé CADA línea individual del detalle — incluyendo las que están en páginas subsiguientes.
- IGNORÁ: "SALDO ANTERIOR", "SU PAGO", "TRANSFERENC FINANC", totales, subtotales, resúmenes consolidados, intereses de financiación, IVA, pago mínimo, saldo actual.
- Cuotas: registrá UNA línea con el monto de la cuota del mes actual. Incluí la cuota en la descripción (ej: "MERPAGO*ALGO C.03/06"). IMPORTANTE: la fecha de la cuota debe ser la FECHA DEL RESUMEN (la del mes actual que aparece en "Estado de cuenta al" o "Cierre"), NO la fecha original de compra.
- Montos negativos en la columna PESOS son devoluciones → kind: "income", monto positivo.
- Fechas en formato YYYY-MM-DD (convertí "28-Feb-26" → "2026-02-28").
- Montos como string numérico con punto decimal, siempre positivos.
- "kind": "expense" para consumos, "income" para devoluciones / créditos.
- "currencyOriginal": "ARS" para montos en la columna PESOS, "USD" para la columna DOLARES.
- "description": detalle del comercio tal como aparece en el resumen.
- Es MUY IMPORTANTE que no te saltees transacciones. Si el detalle continúa en otra página, seguí extrayendo.`;

const USER_PROMPT = `Extraé TODAS las transacciones del resumen de TC ICBC que sigue. Incluí las de TODAS las páginas. Devolvé el JSON con el array "lines".`;

export const icbcTcParser: Parser = {
  id: 'icbc-tc-v2',
  institutionMatch: (name) => /^icbc$/i.test(name.trim()),
  importTypeMatch: (type) => type === 'tc',
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: USER_PROMPT,
  schema: parserOutputSchema,
};
