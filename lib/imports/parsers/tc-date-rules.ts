/**
 * Bloque de reglas de fecha COMPARTIDO por todos los parsers LLM de resúmenes de
 * tarjeta de crédito (Galicia, BNA, ICBC Visa, ICBC Mastercard).
 *
 * Por qué existe: hasta 2026-07 cada parser traía suelta una regla de cuotas que
 * decía "la fecha de la cuota debe ser la FECHA DE CIERRE del resumen, NO la fecha
 * original de compra". Esa era la ÚNICA instrucción fuerte sobre fechas del prompt
 * y el modelo la generalizaba a TODAS las líneas: resúmenes enteros (Galicia Amex,
 * BNA Visa, ICBC Visa) quedaron con los 46/7/15 consumos apilados en la fecha de
 * cierre, con lo que junio-2026 aparecía vacío en los reportes.
 *
 * El bloque mantiene la regla de negocio (la CUOTA se imputa al mes del resumen,
 * no al mes de la compra original) pero la acota explícitamente a las filas de
 * cuota, define la resolución de año para fechas "DD/MM" sin año — el formato de
 * los resúmenes AR — y prohíbe inventar fechas: si una fila no tiene fecha legible
 * se marca para revisión humana en vez de fabricar una.
 */

/** Marcador que el LLM debe poner en `notes` cuando una fila no tiene fecha legible. */
export const UNREADABLE_DATE_MARKER = 'FECHA_NO_LEGIBLE';

export const TC_DATE_RULES_BLOCK = `REGLA DE FECHAS (CRÍTICA — leela entera antes de escribir el JSON):
- "date" es la fecha REAL de la operación de ESA fila: la que el resumen imprime en su columna de fecha. Cada línea lleva SU propia fecha.
- Un resumen cubre ~30 días, así que las fechas de las líneas TIENEN que quedar distribuidas a lo largo del período. Si al terminar ves que pusiste la MISMA fecha en todas (o casi todas) las líneas, está MAL: volvé a leer la columna de fechas fila por fila.
- PROHIBIDO usar la fecha de cierre, la de vencimiento o la del "estado de cuenta al" como fecha de un consumo que tiene su propia fecha impresa.
- Año: las fechas suelen venir sin año ("28/06") o con año de 2 dígitos ("28-JUN-26"). Resolvé el año contra la fecha de cierre del resumen: si el mes de la fila es POSTERIOR al mes de cierre, la fila es del año anterior; si no, del mismo año. Ejemplo con cierre 02/07/2026: "28/06" → 2026-06-28, "01/07" → 2026-07-01, "15/12" → 2025-12-15.
- ÚNICA EXCEPCIÓN — filas de CUOTA (descripción con "C.03/06", "CUOTA 3/6" o similar): esas SÍ llevan la fecha de cierre del resumen, porque el cargo corresponde a este mes y no a la compra original. Incluí SIEMPRE el marcador de cuota en la "description" (ej. "COMERCIO C.03/06") para que se puedan distinguir del resto.
- Si una fila NO tiene fecha legible: NO la inventes. Usá la fecha de cierre y agregá en "notes" el texto exacto ${UNREADABLE_DATE_MARKER} para que se revise a mano.`;
