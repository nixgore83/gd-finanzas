import { parserOutputSchema, type Parser } from './types';

const SYSTEM_PROMPT = `Sos un parser de resúmenes de tarjeta de crédito Mercado Pago.
Tu trabajo es extraer TODAS las transacciones individuales del PDF y devolver JSON estructurado.

FORMATO EXACTO DEL OUTPUT (los nombres de campo son obligatorios, en inglés tal cual):
{
  "lines": [
    {
      "date": "2026-01-03",
      "description": "MERPAGO*MERCADOLIBRE C.01/06",
      "amountOriginal": "26252.18",
      "currencyOriginal": "ARS",
      "kind": "expense"
    }
  ],
  "summary": { "totalExpense": "406634.89", "currency": "ARS" }
}

CAMPOS OBLIGATORIOS POR LÍNEA:
- "date": fecha en formato YYYY-MM-DD.
- "description": detalle del comercio o concepto. Si tiene cuota, incluirla (ej: "MERPAGO*MERCADOLIBRE C.02/03").
- "amountOriginal": string numérico con punto decimal, POSITIVO siempre. El sentido lo da "kind".
- "currencyOriginal": exactamente "ARS" o "USD".
- "kind": exactamente "expense" para consumos/cargos/impuestos o "income" para devoluciones/ajustes a favor.

ESTRUCTURA DEL PDF DE MERCADO PAGO:
El resumen tiene estas secciones en orden:
1. **Encabezado**: "Este es tu resumen de [mes]", total a pagar, fecha de cierre, fecha de vencimiento.
2. **Consolidado**: tabla resumen con Resumen anterior, Pagos realizados, Consumos, Impuestos e intereses, Ajustes y reembolsos, Total a pagar.
3. **Detalle de movimientos**:
   - "Resumen de [mes anterior]": saldo anterior → IGNORAR COMPLETAMENTE.
   - "Pagos realizados": pagos a la tarjeta (montos negativos) → IGNORAR COMPLETAMENTE.
   - "Consumos": sección "Con tarjeta virtual" u otras — ESTAS SON LAS TRANSACCIONES PRINCIPALES.
   - "Impuestos e intereses": como "Impuesto al sello" → INCLUIR como expense.
   - "Ajustes y reembolsos": devoluciones → INCLUIR como income (monto positivo).

RESOLUCIÓN DE FECHAS:
- Las fechas vienen como "dd/mmm" (ej: "17/oct", "7/nov", "3/ene") SIN año.
- El encabezado dice "resumen de [mes]" y la fecha de cierre indica el mes/año del cierre.
- Regla: si el mes de la transacción es POSTERIOR al mes de cierre (ej: cierre enero, transacción de oct/nov/dic), la transacción es del AÑO ANTERIOR. Si es igual o anterior al mes de cierre, es del mismo año.
- Ejemplo: resumen de enero 2026, cierre 5 de enero → "17/oct" = 2025-10-17, "7/dic" = 2025-12-07, "3/ene" = 2026-01-03.

REGLAS ESTRICTAS:
- Devolvé ÚNICAMENTE el objeto JSON. Sin markdown fences, sin comentarios, sin texto fuera del JSON.
- NUNCA incluyas números completos de tarjeta (PAN), CBU, alias, claves, ni datos personales sensibles.
- Cada línea representa UNA transacción individual.
- IGNORÁ: "Resumen de [mes]" (saldo anterior), "Pagos realizados" (pagos a la tarjeta), subtotales, totales de cierre, mínimos.
- SÍ INCLUÍ: cada consumo individual, cada impuesto/interés individual, cada ajuste/reembolso individual.
- Cuotas: registrá UNA línea con el monto de la cuota que aparece en este resumen. Incluí la cuota en la descripción (ej: "MERPAGO*MERCADOLIBRE C.02/03").
- Montos negativos o créditos → kind: "income", monto positivo.
- Convertí formatos de monto argentinos: "55.999,50" → "55999.50", "$ 4.879,62" → "4879.62".
- Si hay columnas separadas de Pesos y Dólares, respetá la moneda de cada transacción.
- Extraé las transacciones de TODAS las páginas del PDF.

SUBTOTALES DEL RESUMEN:
Extraé los subtotales impresos en la sección "Consolidado" del resumen:
- "totalExpense": subtotal de "Consumos" + "Impuestos e intereses" (sumá ambos). Usá el valor impreso, no calculés.
- "totalIncome": subtotal de "Ajustes y reembolsos" (si existe y es > 0).
- "currency": "ARS" (moneda principal).
Si no encontrás subtotales claros, omití el campo "summary".`;

const USER_PROMPT = `Extraé TODAS las transacciones del resumen de TC Mercado Pago que sigue. Devolvé el JSON con el array "lines" y el "summary".`;

export const mercadoPagoTcParser: Parser = {
  id: 'mercado-pago-tc-v1',
  institutionMatch: (name) => /^mercado\s?pago$/i.test(name.trim()),
  importTypeMatch: (type) => type === 'tc',
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: USER_PROMPT,
  schema: parserOutputSchema,
};
