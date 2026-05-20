/**
 * Genera el README.txt que va en el .zip del export contador.
 * Texto fijo del PRD §5.7 + año exportado + lista de archivos.
 */
export function buildReadme(year: number, householdName: string): string {
  return `EXPORT GANANCIAS ${year}
========================

Household: ${householdName}
Generado: ${new Date().toISOString()}

ARCHIVOS INCLUIDOS
------------------
01_ingresos.csv          — Todos los ingresos del año.
02_consumos_tc.csv       — Consumos en tarjetas de crédito, totalizados por
                           tarjeta + moneda + mes.
03_servicio_domestico.csv — Pagos a empleados/as domésticos con datos del
                           empleado (nombre, CUIL, concepto, período).
04_gastos_deducibles.csv — Gastos marcados como "deducible Ganancias" en la
                           app.
05_otros_ingresos.csv    — Ingresos cuya categoría no contiene "sueldo"
                           (alquileres, intereses, dividendos, etc.).

FORMATO
-------
CSV UTF-8 con BOM (Excel debería abrir con acentos correctos).
Separador: coma. Encoding: UTF-8. Numerales: punto decimal.

ALCANCE
-------
Este export cubre aprox. 30% del checklist de Ganancias — la parte de
movimientos transaccionales. NO incluye items patrimoniales:

  - Saldos de cuentas al 31/12.
  - Inmuebles, rodados, otros bienes.
  - Inversiones (tenencias a fin de año).
  - Deuda al 31/12.

Esos items se preparan aparte y se reportan también al contador (V2 del
sistema los va a cubrir).

PREGUNTAS
---------
Si hay dudas sobre algún monto, las transacciones individuales viven en la
app (https://gd-finanzas-z4dl.vercel.app/transactions). Cada fila del CSV
corresponde a una transacción cargada manualmente, importada de un resumen
con AI parser, o generada por una recurrencia.
`;
}
