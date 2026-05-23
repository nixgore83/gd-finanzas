import { parserOutputSchema, type Parser } from './types';

const SYSTEM_PROMPT = `Sos un parser de resúmenes de tarjeta de crédito ICBC Mastercard.
Tu trabajo es extraer TODAS las transacciones individuales del PDF y devolver JSON estructurado.

FORMATO DEL PDF ICBC MASTERCARD:
- El resumen tiene una sección "DETALLE DEL MES" con columnas: FECHA | Detalle de Cargos y Ajustes | NRO CUPON | PESOS | DOLARES.
- La tabla de transacciones puede continuar en las páginas siguientes con un formato tabular compacto (fecha DD-MMM-YY, descripción, número, monto). NO se repite el encabezado de columnas — seguí extrayendo.
- Algunas filas tienen la descripción partida en 2 líneas: la primera tiene la fecha y la descripción truncada, la segunda continúa la descripción sin fecha. Concatenalas en una sola línea.

REGLAS ESTRICTAS:
- Devolvé ÚNICAMENTE un objeto JSON con la forma { "lines": [...] }. Sin markdown fences, sin comentarios.
- NUNCA incluyas números completos de tarjeta (PAN), CBU, alias, claves, ni datos personales sensibles.
- Extraé CADA línea individual del detalle — incluyendo las que están en páginas subsiguientes.
- IGNORÁ: "SALDO ANTERIOR", "SU PAGO", "TRANSFERENC FINANC", "RESUMEN CONSOLIDADO", totales, subtotales, intereses de financiación, IVA, pago mínimo, saldo actual, comisiones y ajustes globales.
- CUOTAS: registrá UNA línea con el monto de la cuota del mes actual. Incluí la cuota en la descripción (ej: "MERPAGO*ALGO C.03/06"). IMPORTANTE: la fecha de la cuota debe ser la FECHA DEL RESUMEN (la del mes actual que aparece en el encabezado como "Estado de cuenta al" o "Cierre"), NO la fecha original de compra.
- Montos negativos en la columna PESOS son devoluciones → kind: "income", monto positivo.
- Fechas en formato YYYY-MM-DD (convertí "28-Feb-26" → "2026-02-28").
- Montos como string numérico con punto decimal, siempre positivos. Convertí "53.050,00" → "53050.00".
- "kind": "expense" para consumos, "income" para devoluciones / créditos.
- "currencyOriginal": "ARS" para montos en la columna PESOS, "USD" para la columna DOLARES.
- "description": detalle del comercio tal como aparece en el resumen.

IMPORTANTE: Este formato suele tener muchas transacciones (40-80+). Leé TODAS las páginas del PDF de principio a fin. NO pares antes de llegar al final del detalle.
Antes de armar el JSON, contá mentalmente cuántas filas de transacción ves en total. Si tu JSON tiene significativamente menos líneas que las que contaste, volvé a leer el PDF.`;

const USER_PROMPT = `Extraé TODAS las transacciones del resumen de TC ICBC Mastercard que sigue. Incluí las de TODAS las páginas del detalle. Devolvé el JSON con el array "lines".`;

export const icbcMastercardTcParser: Parser = {
  id: 'icbc-mastercard-tc-v1',
  institutionMatch: (name) => /^icbc$/i.test(name.trim()),
  importTypeMatch: (type) => type === 'tc',
  accountMatch: (name) => /master/i.test(name),
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: USER_PROMPT,
  schema: parserOutputSchema,
};
