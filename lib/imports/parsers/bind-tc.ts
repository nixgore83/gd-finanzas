import { parserOutputSchema, type Parser } from './types';
import { TC_DATE_RULES_BLOCK } from './tc-date-rules';

/**
 * Resúmenes de tarjeta Visa emitidos por Banco Industrial (BIND).
 *
 * Formato: layout clásico de Prisma/Visa, de ancho fijo, bimonetario — una sola
 * grilla con columnas PESOS y DOLARES, no dos secciones separadas como Galicia.
 * El encabezado trae "FECHA COMPROBANTE DETALLE DE TRANSACCION PESOS DOLARES" y
 * el monto cae en la columna de su moneda.
 *
 * Volumen bajo: entre 1 y 11 movimientos por resumen, varios de ellos "SU PAGO
 * EN PESOS" (que se ignoran, como en el resto de los parsers de TC).
 */

const SYSTEM_PROMPT = `Sos un parser de resúmenes de tarjeta de crédito Visa de Banco Industrial (BIND).
Tu trabajo es extraer TODAS las transacciones individuales del PDF y devolver JSON estructurado.

FORMATO EXACTO DEL OUTPUT (los nombres de campo son obligatorios, en inglés tal cual):
{
  "lines": [
    {
      "date": "2026-04-15",
      "description": "SUPERMERCADO COTO",
      "amountOriginal": "45000.00",
      "currencyOriginal": "ARS",
      "kind": "expense"
    }
  ]
}

CAMPOS OBLIGATORIOS POR LÍNEA:
- "date": fecha en formato YYYY-MM-DD. Ver "REGLA DE FECHAS" más abajo.
- "description": el texto de la columna "DETALLE DE TRANSACCION".
- "amountOriginal": string numérico con punto decimal, POSITIVO siempre. El sentido lo da "kind".
- "currencyOriginal": exactamente "ARS" o "USD".
- "kind": exactamente "expense" para consumos/cargos o "income" para devoluciones/créditos.

LAYOUT DE ESTE RESUMEN (importante):
- La grilla tiene el encabezado "FECHA COMPROBANTE DETALLE DE TRANSACCION PESOS DOLARES".
- Es BIMONETARIA en una sola grilla: cada fila trae el importe en la columna PESOS o en la columna DOLARES. La moneda de la línea la define EN QUÉ COLUMNA está el número, no una sección aparte.
- Si una fila tiene importe en la columna DOLARES → "currencyOriginal": "USD". Si lo tiene en PESOS → "ARS".
- Las fechas de la columna FECHA vienen como DD.MM.YY (ej. "22.07.26").

REGLAS ESTRICTAS:
- Devolvé ÚNICAMENTE el objeto JSON. Sin markdown fences, sin comentarios, sin texto fuera del JSON.
- NUNCA incluyas números completos de tarjeta (PAN), CBU, alias, claves, ni datos personales sensibles.
- Cada línea representa UNA transacción individual.
- IGNORÁ: "SALDO ANTERIOR", "SALDO ACTUAL", "PAGO MINIMO", los bloques de LIMITES y TASAS, y los pagos realizados ("SU PAGO EN PESOS", "SU PAGO EN DOLARES", "SU PAGO"). No son consumos.
- IGNORÁ todo el texto legal del pie (Régimen de Transparencia, DNU 70/2023, cupo de US$ 200, etc.). No son transacciones.
- Cuotas: registrá UNA línea con el monto de la cuota del mes actual, con el marcador de cuota en la descripción.
- Montos negativos o créditos → kind: "income", monto positivo.
- Convertí formatos de monto argentinos: "45.000,00" → "45000.00".
- Si el resumen NO tiene ningún consumo (sólo pagos y saldos), devolvé "lines": [].
- Extraé las transacciones de TODAS las páginas del PDF.

${TC_DATE_RULES_BLOCK}

SUBTOTALES DEL RESUMEN:
Además de las líneas, extraé los subtotales impresos y agregalos como campo "summary" en el JSON raíz:
{ "lines": [...], "summary": { "totalExpense": "12345.67", "totalIncome": "890.00", "currency": "ARS" } }
- "totalExpense": total de consumos del período que imprime el banco (NO la suma que calculás vos).
- "totalIncome": total de pagos/créditos/devoluciones.
- "currency": moneda principal del resumen ("ARS" o "USD").
- Si no encontrás subtotales claramente impresos, omití el campo "summary".`;

const USER_PROMPT = `Extraé TODAS las transacciones del resumen de tarjeta Visa de Banco Industrial (BIND) que sigue. Devolvé el JSON con el array "lines".`;

export const bindTcParser: Parser = {
  id: 'bind-tc-v1',
  institutionMatch: (name) => /banco\s+industrial|^bind$/i.test(name.trim()),
  importTypeMatch: (type) => type === 'tc',
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: USER_PROMPT,
  schema: parserOutputSchema,
};
