import { extractStatementDate } from '@/lib/imports/bulk-routing';

/**
 * Bloque opcional del system prompt que le dice al parser A QUÉ PERÍODO
 * pertenece el resumen, derivado del NOMBRE del archivo.
 *
 * Por qué existe: hay resúmenes que **no imprimen el año en ninguna parte**. El
 * de tarjeta de Mercado Pago es el caso testigo: el encabezado dice "Este es tu
 * resumen de julio" y "Fecha de cierre 5 de julio", las filas de consumo dicen
 * "4/mar", "9/abr" — y no hay un solo año de 4 dígitos en todo el PDF (los
 * únicos que aparecen son CUIT y DNI). Sin una referencia externa el año es
 * inadivinable, y el modelo lo inventaba: los resúmenes de ene/feb 2026 salieron
 * bien de casualidad y los de mar–jul 2026 salieron fechados en 2025, con lo que
 * el detector de gaps (`lib/imports/detect-gaps.ts`) los reportaba como meses
 * faltantes aunque estuvieran importados.
 *
 * La referencia sale del nombre del archivo, que es la misma señal que ya usan
 * el ruteo masivo (`extractStatementDate`) y el router de adjuntos de Gmail.
 *
 * Es ADITIVO y CONSERVADOR:
 * - Sin fecha derivable del nombre devuelve string vacío y el prompt queda igual.
 * - El bloque acota su propio uso: sirve para completar el año que falta, y si el
 *   PDF imprime el año explícito manda el PDF. Un nombre de archivo mal puesto no
 *   puede pisar un dato que el extracto sí trae.
 */
export function buildStatementDateBlock(fileName: string | null | undefined): string {
  const name = (fileName ?? '').trim();
  if (!name) return '';

  const date = extractStatementDate(name);
  if (!date) return '';

  const periodo =
    date.precision === 'day'
      ? `el resumen CIERRA el ${date.value} (YYYY-MM-DD)`
      : `el resumen corresponde al mes ${date.value} (YYYY-MM): su fecha de cierre cae en ese mes`;

  return `\n\nPERÍODO DEL RESUMEN (referencia externa): ${periodo}.
Este dato NO sale del contenido del archivo sino de cómo está archivado, y existe porque varios resúmenes imprimen las fechas SIN AÑO ("5 de julio", "17/oct", "4/mar").
Cómo usarlo:
- Es el año/mes del CIERRE. Resolvé contra él los años que las filas no traen, con la regla de años que ya tenés.
- Si el PDF imprime el año de forma explícita, MANDA EL PDF: ignorá esta referencia.
- NO es la fecha de ninguna línea por sí sola: no la copies como "date" de un movimiento salvo que la regla de fechas te lo indique (ej. filas de cuota).`;
}
