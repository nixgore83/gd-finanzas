import { parserOutputSchema, type Parser } from './types';

/**
 * Extractos de cuenta de Banco Industrial (BIND), formato "Cuentas bantotal".
 *
 * Particularidad que lo distingue del resto de los parsers de banco: **un solo
 * PDF es CONSOLIDADO y cubre varias sub-cuentas** del mismo titular (paquete de
 * haberes), cada una con su moneda y su propia grilla de movimientos:
 *
 *   RESUMEN DE PRODUCTOS
 *     EMPLEADOS SIN INTERESES PESOS   <nro>/1
 *     HABERES Empleados DOLAR BILLETE <nro>/2
 *     HABERES Empleados PESOS         <nro>/3
 *     HABERES Empleados EURO BILLETE  <nro>/4
 *   DETALLE POR PRODUCTO
 *     <producto> N° <nro>/K CBU Nº ...
 *     FECHA DETALLE REFERENCIA DEBITOS CREDITOS SALDO
 *     DD/MM/YY  <concepto>  <ref>  <débito>  <crédito>  <saldo>
 *
 * Como el modelo de la app es `1 import → 1 cuenta`, el mismo archivo se sube una
 * vez por cuenta destino y el parseo se acota a SU sub-cuenta. El sufijo de la
 * sub-cuenta ("/2", "/3") viaja en el bloque "CUENTA DESTINO" que
 * `parse-internal` agrega al prompt a partir de `accounts.account_number`.
 *
 * Además el período es SEMESTRAL (no mensual), así que un archivo trae ~6 meses.
 */

const SYSTEM_PROMPT = `Sos un parser de extractos de cuenta de Banco Industrial (BIND), formato "Cuentas bantotal".
Extraé los movimientos y devolvé JSON { "lines": [...] }.

ESTRUCTURA DEL ARCHIVO (crítica — leela antes de extraer nada):
- Este extracto es CONSOLIDADO: contiene VARIAS sub-cuentas del mismo titular, cada una con su propia grilla de movimientos.
- La sección "RESUMEN DE PRODUCTOS" lista las sub-cuentas; la sección "DETALLE POR PRODUCTO" trae una grilla por cada una.
- Cada grilla arranca con una línea de producto tipo "HABERES Empleados PESOS N° 1234567/3 CBU Nº ..." — el número DESPUÉS de la barra ("/3") es el identificador de la sub-cuenta.
- La grilla tiene encabezado "FECHA DETALLE REFERENCIA DEBITOS CREDITOS SALDO".

CUÁL SUB-CUENTA EXTRAER:
- Si más abajo aparece un bloque "CUENTA DESTINO" con un número de cuenta, extraé ÚNICAMENTE los movimientos de la sub-cuenta cuyo identificador coincida con ese número (comparando el sufijo después de la barra).
- Si NO aparece ese bloque, extraé los movimientos de TODAS las sub-cuentas en pesos y dólares.
- IGNORÁ SIEMPRE las sub-cuentas en EURO: la app no maneja esa moneda.

MONEDA:
- La moneda sale del NOMBRE del producto de esa grilla: "... PESOS" → "ARS"; "... DOLAR BILLETE" → "USD"; "... EURO BILLETE" → ignorar la grilla entera.

CAMPOS POR LÍNEA:
- "date": YYYY-MM-DD. En este extracto las fechas vienen DD/MM/YY (ej. "26/03/26" → 2026-03-26). El día puede venir sin cero a la izquierda ("2/01/26").
- "description": el texto de la columna DETALLE (ej. "Pago Haberes", "Débito Transf entre Cuentas").
- "amountOriginal": string numérico POSITIVO con punto decimal. Montos en formato es-AR ("1.234.567,89" → "1234567.89").
- "kind": "expense" si el importe está en la columna DEBITOS, "income" si está en CREDITOS.
- "currencyOriginal": según la regla de MONEDA de arriba.
- "counterparty": si el movimiento identifica una contraparte (nombre, CUIT, CBU, alias), extraela en { name, cuil, cbu, alias }. No la mezcles dentro de "description".

QUÉ IGNORAR (no son movimientos):
- "SALDO INICIAL", "SALDO FINAL", "Transporte" (arrastre de saldo entre páginas), y los encabezados repetidos en cada página.
- Las secciones "DEBITOS AUTOMATICOS" que dicen "NO SE HAN REGISTRADO MOVIMIENTOS EN ESTE PERIODO".
- Las sub-cuentas que dicen "SIN MOVIMIENTOS EN EL PERIODO".
- El bloque "TITULARIDAD DE LA CUENTA" y "RESUMEN DE PRODUCTOS" (son totales, no movimientos).

CLASIFICACIÓN (marcá "isTransfer": true cuando corresponda):
- "Débito Transf entre Cuentas" / "Crédito Transf. entre Cuentas" → movimiento entre cuentas propias: "isTransfer": true.
- "Pago Tarjeta VISA" → pago de tarjeta propia: "isTransfer": true.
- "Compra Moneda Extranjera" → compra de dólares, mueve plata entre cuentas propias: "isTransfer": true.
- "Pago Haberes" → INGRESO real (sueldo): "kind": "income", "isTransfer": false.
- "Acreditación de Intereses" → ingreso real por intereses: "isTransfer": false.
- "Crédito por Transferencia" de un tercero → ingreso real; extraé la contraparte si figura.

REGLAS ESTRICTAS:
- Devolvé ÚNICAMENTE el objeto JSON. Sin markdown fences, sin comentarios, sin texto fuera del JSON.
- NUNCA incluyas claves, PINs, credenciales ni números completos de tarjeta.
- No inventes fechas ni montos. Si una fila no es legible, omitila antes que adivinar.
- Extraé los movimientos de TODAS las páginas.`;

const USER_PROMPT = `Extraé los movimientos del extracto de cuenta de Banco Industrial (BIND) que sigue, respetando la sub-cuenta indicada. Devolvé el JSON con "lines".`;

export const bindBancoParser: Parser = {
  id: 'bind-banco-v1',
  institutionMatch: (name) => /banco\s+industrial|^bind$/i.test(name.trim()),
  importTypeMatch: (type) => type === 'banco',
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: USER_PROMPT,
  schema: parserOutputSchema,
};
