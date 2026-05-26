import { parserOutputSchema, type Parser } from './types';

const SYSTEM_PROMPT = `Sos un parser de resúmenes de cuenta broker de Cocos Capital.
Tu trabajo es extraer los movimientos individuales del PDF y devolver JSON estructurado.

El PDF tiene varias secciones. Usá la sección "INCREMENTOS/DECREMENTOS DE LA INVERSION" como fuente principal de movimientos.
Si esa sección no existe, usá la sección "MOVIMIENTOS".

ESTRUCTURA DE "INCREMENTOS/DECREMENTOS DE LA INVERSION":
Tabla con columnas: FECHA LIQ | COMPROBANTE | ESPECIE | CANTIDAD | PRECIO | TIPO DE CAMBIO | ARS | USD

ESTRUCTURA DE "MOVIMIENTOS":
Tabla con columnas: FECHA LIQ | FECHA CONC | COMPROBANTE | ESPECIE | CANTIDAD | PRECIO | ARS | USD MEP | USD CABLE

TIPOS DE MOVIMIENTO (campo COMPROBANTE):
- "Dividendos En Especie - NUMERO" → kind: "income", description: "Dividendo en especie" (incluí el ticker de ESPECIE)
- "Dividendos - NUMERO" → kind: "income", description: "Dividendo" (incluí el ticker si hay)
- "Recibo De Cobro Dolares - NUMERO" → kind: "income", description: "Cobro USD", isTransfer: true
- "Retiro Titulos Transf - NUMERO" → kind: "expense", description: "Retiro títulos", isTransfer: true
- "Nota De Credito Conversion - NUMERO" → kind: "income", description: "Conversión crédito", isTransfer: true
- "Orden De Pago - NUMERO" → kind: "expense", description: "Retiro de fondos ARS", isTransfer: true
- "Orden De Pago Usd - NUMERO" → kind: "expense", description: "Retiro de fondos USD", isTransfer: true
- "Venta Dolar Mep - NUMERO" → kind: "income", description: "Venta dólar MEP" (incluí el ticker de ESPECIE: GGAL, TEN, etc.)
- "Venta - NUMERO" → kind: "income", description: "Venta TICKER x CANTIDAD"
- "Compra - NUMERO" → kind: "expense", description: "Compra TICKER x CANTIDAD"
- "Liq Suscripcion Fci Usd - NUMERO" → kind: "expense", description: "Suscripción FCI NOMBRE_FONDO"
- "Liq Rescate Fci Usd - NUMERO" → kind: "income", description: "Rescate FCI NOMBRE_FONDO"
- "Liq Suscripcion Fci - NUMERO" → kind: "expense", description: "Suscripción FCI NOMBRE_FONDO"
- "Liq Rescate Fci - NUMERO" → kind: "income", description: "Rescate FCI NOMBRE_FONDO"

REGLAS GENERALES:
- Devolvé ÚNICAMENTE un objeto JSON con la forma { "lines": [...] }.
- NO incluyas markdown fences ni texto fuera del JSON.
- IGNORÁ: "POSICION AL CIERRE", "MOVIMIENTOS POR ESPECIE", "Saldo al cierre", "Saldo al DD-MM-YYYY", "INCREMENTO DE LA INVERSION", "TOTAL DE LA INVERSION", totales, encabezados, textos legales.
- Solo extraé líneas que son MOVIMIENTOS REALES (tienen FECHA LIQ).
- Fechas en formato YYYY-MM-DD. Si dice "08-01-2026", convertí a "2026-01-08". Si dice "06-03-2026", es "2026-03-06".
- Montos: usá el valor absoluto de la columna USD (o USD MEP si no hay USD). Si el valor USD es negativo, es expense; si es positivo, es income.
- Montos como string numérico positivo sin separadores de miles (ej: "1043.36"); el campo "kind" da la dirección.
- "currencyOriginal": "USD" para todos los movimientos (la cuenta Cocos opera en USD).
  EXCEPCIÓN: si un movimiento solo tiene valor ARS y la especie dice "Peso argentino" o "ARS", usá "ARS" y tomá el monto de la columna ARS.
- En la description, incluí el ticker entre paréntesis cuando haya un instrumento involucrado (ej: "Dividendo en especie (NVDA)", "Venta dólar MEP (GGAL)").
- NO incluyas el número de comprobante en la descripción.
- "isTransfer": true para Órdenes de Pago, Recibos de Cobro, Retiro Títulos Transf, Nota De Credito Conversion (son movimientos de efectivo entre cuentas).
- Para pares "Retiro Titulos Transf" + "Nota De Credito Conversion" del mismo día con montos iguales y opuestos: ambos son transfer legs de una operación MEP. Incluí ambos.
- NUNCA incluyas número de comitente, CUIT ni datos personales.

SUBTOTALES:
Si hay fila "INCREMENTO DE LA INVERSION" al final, usala como summary:
{ "lines": [...], "summary": { "totalExpense": "...", "totalIncome": "...", "currency": "USD" } }
Calculá totalIncome = suma de USD positivos, totalExpense = suma de |USD negativos|.`;

const USER_PROMPT = `Extraé todos los movimientos del resumen de cuenta Cocos del PDF. Usá la sección INCREMENTOS/DECREMENTOS como fuente principal. Devolvé el JSON con "lines". Ignorá posiciones, saldos y totales.`;

export const cocosBrokerParser: Parser = {
  id: 'cocos-broker-v1',
  institutionMatch: (name) => /cocos/i.test(name.trim()),
  importTypeMatch: (type) => type === 'broker',
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: USER_PROMPT,
  schema: parserOutputSchema,
};
