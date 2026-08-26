import { TC_DATE_RULES_BLOCK } from './tc-date-rules';
import { parserOutputSchema, type Parser } from './types';

/**
 * Parser del resumen de TARJETA DE CRÉDITO de Mercado Pago.
 *
 * Particularidad crítica: **el PDF no imprime el año en ninguna parte.** El
 * encabezado dice "Este es tu resumen de julio" y "Fecha de cierre 5 de julio",
 * y las filas de consumo dicen "4/mar", "9/abr". Los únicos números de 4 dígitos
 * del archivo son el CUIT y el DNI del titular. El año llega por afuera, del
 * nombre del archivo, vía `lib/imports/statement-date-block.ts` — sin eso el
 * modelo lo inventa (pasó: los resúmenes de mar–jul 2026 quedaron fechados en
 * 2025 y el detector de gaps los reportaba como meses sin importar).
 *
 * Segunda particularidad: MP imprime la cuota en una COLUMNA aparte ("Cuota:
 * 5 de 6"), no dentro de la descripción. Como la regla de negocio imputa la
 * cuota al mes del resumen (no al de la compra original), hay que reconocerla
 * ahí y arrastrarla a la descripción para que quede trazable.
 */
const SYSTEM_PROMPT = `Sos un parser de resúmenes de tarjeta de crédito Mercado Pago.
Tu trabajo es extraer TODAS las transacciones individuales del PDF y devolver JSON estructurado.

FORMATO EXACTO DEL OUTPUT (los nombres de campo son obligatorios, en inglés tal cual):
{
  "lines": [
    {
      "date": "2026-07-05",
      "description": "MERPAGO*MERCADOLIBRE C.01/06",
      "amountOriginal": "26252.18",
      "currencyOriginal": "ARS",
      "kind": "expense"
    }
  ],
  "summary": { "totalExpense": "406634.89", "currency": "ARS" }
}

CAMPOS OBLIGATORIOS POR LÍNEA:
- "date": fecha en formato YYYY-MM-DD. Ver "REGLA DE FECHAS" más abajo.
- "description": detalle del comercio o concepto. Si tiene cuota, incluirla (ej: "MERPAGO*MERCADOLIBRE C.02/03").
- "amountOriginal": string numérico con punto decimal, POSITIVO siempre. El sentido lo da "kind".
- "currencyOriginal": exactamente "ARS" o "USD".
- "kind": exactamente "expense" para consumos/cargos/impuestos o "income" para devoluciones/ajustes a favor.

ESTRUCTURA DEL PDF DE MERCADO PAGO:
1. **Encabezado**: "Este es tu resumen de [mes]", "Total a pagar", "Fecha de cierre [D de mes]", "Fecha de vencimiento".
2. **Consolidado**: tabla resumen con "Saldo del periodo anterior", "Consumos", "Impuestos e intereses", "Pagos anticipados", "Ajustes y reembolsos", "Total a pagar".
3. **DETALLE DE MOVIMIENTOS**, con estas secciones:
   - "Composición del saldo del periodo anterior": trae "Total a pagar del periodo anterior" y "Débito automático de tarjeta" → IGNORAR LA SECCIÓN ENTERA. No son consumos de este resumen; incluirlos duplica el mes anterior y mete el pago de la tarjeta como gasto.
   - "Consumos" (subsecciones tipo "Con tarjeta virtual"): columnas Fecha | Descripción | Cuota | Operación | Pesos | Dólares. ESTAS SON LAS TRANSACCIONES PRINCIPALES.
   - "Impuestos e intereses" (ej. "Impuesto al sello Buenos Aires") → INCLUIR como expense.
   - "Pagos anticipados" → IGNORAR (son pagos a la tarjeta, no consumos).
   - "Ajustes y reembolsos" (ej. "Reembolso de COMERCIO") → INCLUIR como income.

CUOTAS — CÓMO VIENEN EN ESTE RESUMEN:
- MP imprime la cuota en una COLUMNA PROPIA con el formato "5 de 6" (no la mete en la descripción).
- Si la fila tiene algo en esa columna, ES UNA FILA DE CUOTA. Escribila en la "description" como "C.05/06" pegado al comercio: "MERPAGO*3DINS C.05/06".
- La fecha que MP imprime en la columna Fecha de una fila de cuota es la de la COMPRA ORIGINAL (por eso dos cuotas consecutivas del mismo comercio repiten la misma fecha en resúmenes distintos). NO es la fecha del cargo. Ver la regla de fechas.

${TC_DATE_RULES_BLOCK}

AÑO — ATENCIÓN, CASO PARTICULAR DE MERCADO PAGO:
- Este PDF NO IMPRIME EL AÑO EN NINGUNA PARTE: ni en "resumen de [mes]", ni en "Fecha de cierre [D de mes]", ni en las filas ("4/mar", "9/abr"). Los únicos números de 4 dígitos del archivo son CUIT y DNI del titular: NO son años, no los uses.
- Tomá el año del bloque "PERÍODO DEL RESUMEN" que viene más abajo en estas instrucciones, y con él armá la fecha de cierre completa (ej. mes 2026-07 + "Fecha de cierre 5 de julio" → cierre = 2026-07-05).
- Recién con esa fecha de cierre resolvé el año de las filas, con la regla de años de arriba.
- Si NO recibiste ese bloque, no inventes el año: resolvé todo contra el mes de cierre asumiendo el año en curso y agregá en "notes" de cada línea el texto exacto FECHA_NO_LEGIBLE.

REGLAS ESTRICTAS:
- Devolvé ÚNICAMENTE el objeto JSON. Sin markdown fences, sin comentarios, sin texto fuera del JSON.
- NUNCA incluyas números completos de tarjeta (PAN), CBU, alias, claves, ni datos personales sensibles.
- Cada línea representa UNA transacción individual.
- IGNORÁ: la sección "Composición del saldo del periodo anterior", los "Pagos anticipados", subtotales, totales de cierre y mínimos a pagar.
- SÍ INCLUÍ: cada consumo individual, cada impuesto/interés individual, cada ajuste/reembolso individual.
- Cuotas: registrá UNA línea con el monto de la cuota que aparece en ESTE resumen (no el total de la compra).
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
