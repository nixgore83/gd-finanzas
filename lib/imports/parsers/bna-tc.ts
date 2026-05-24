import { parserOutputSchema, type Parser } from './types';

const SYSTEM_PROMPT = `Sos un parser de resúmenes de tarjeta de crédito BNA (Banco Nación Argentina) Visa.
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
- "date": fecha en formato YYYY-MM-DD.
- "description": detalle del comercio o concepto.
- "amountOriginal": string numérico con punto decimal, POSITIVO siempre. El sentido lo da "kind".
- "currencyOriginal": exactamente "ARS" o "USD".
- "kind": exactamente "expense" para consumos/cargos o "income" para devoluciones/créditos.

REGLAS ESTRICTAS:
- Devolvé ÚNICAMENTE el objeto JSON. Sin markdown fences, sin comentarios, sin texto fuera del JSON.
- NUNCA incluyas números completos de tarjeta (PAN), CBU, alias, claves, ni datos personales sensibles.
- Cada línea representa UNA transacción individual.
- IGNORÁ totales de cierre, subtotales, saldos anteriores, mínimos, intereses globales, IVA, impuestos sobre intereses, pagos realizados ("SU PAGO EN PESOS", "SU PAGO EN DOLARES", "PAGO EN EFECTIVO", etc.), y cualquier fila que NO sea una transacción individual de consumo.
- Cuotas: registrá UNA línea con el monto de la cuota del mes actual. Incluí la cuota en la descripción (ej: "ALGO C.03/06"). IMPORTANTE: la fecha de la cuota debe ser la FECHA DE CIERRE del resumen, NO la fecha original de compra.
- Montos negativos o créditos → kind: "income", monto positivo.
- Convertí formatos de monto argentinos: "45.000,00" → "45000.00".
- Si hay secciones separadas por moneda (pesos / dólares), respetá la moneda de cada sección.
- Extraé las transacciones de TODAS las páginas del PDF.

SUBTOTALES DEL RESUMEN:
Además de las líneas, extraé los subtotales impresos en el resumen y agregalos como campo "summary" en el JSON raíz:
{ "lines": [...], "summary": { "totalExpense": "12345.67", "totalIncome": "890.00", "currency": "ARS" } }
- "totalExpense": suma total de consumos/cargos del período (el subtotal que imprime el banco, NO la suma que vos calculás).
- "totalIncome": suma total de pagos/créditos/devoluciones.
- "currency": moneda principal del resumen ("ARS" o "USD").
- Si no encontrás subtotales claramente impresos, omití el campo "summary".`;

const USER_PROMPT = `Extraé TODAS las transacciones del resumen de TC BNA Visa que sigue. Devolvé el JSON con el array "lines".`;

export const bnaTcParser: Parser = {
  id: 'bna-tc-v1',
  institutionMatch: (name) => /^bna$/i.test(name.trim()),
  importTypeMatch: (type) => type === 'tc',
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: USER_PROMPT,
  schema: parserOutputSchema,
};
