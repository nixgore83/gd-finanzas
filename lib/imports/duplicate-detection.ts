import Decimal from 'decimal.js';

/**
 * Detección de movimientos que YA existen como transacción, para avisar antes de
 * confirmar un import.
 *
 * ### Por qué el dedup por archivo no alcanza
 *
 * Las defensas existentes operan sobre el ARCHIVO: hash idéntico
 * (`createImportInternal`) y período solapado (`bulk-routing`). Ninguna sirve
 * para el caso que se comió una tarde entera el 2026-08-14: un extracto de junio
 * que cubre desde enero es un archivo legítimamente nuevo, con hash nuevo, que
 * vuelve a listar todo lo ya cargado por otras vías. 327 de 411 líneas de ICBC
 * ya existían; confirmarlas habría duplicado una cuenta que se había
 * reconciliado a mano contra el listado del banco.
 *
 * Tampoco sirve comparar descripciones: cada fuente escribe el mismo movimiento
 * distinto ("Transf. Mobile" vs. el texto que generó una reconciliación previa).
 * De esas 327, sólo 30 coincidían en texto.
 *
 * Lo único estable entre fuentes es `(cuenta, fecha, monto)`.
 *
 * ### Por qué NO alcanza con agrupar por (cuenta, fecha, monto)
 *
 * Repetir el mismo importe el mismo día es COMÚN y legítimo: en la caja de
 * ahorro de Pau hay dos grupos de 16 movimientos idénticos el mismo día
 * ("TRANSFERENCIA DE TERCEROS"), y 125 grupos de 2 ("COMPRA DEBITO - EL SOL DE
 * MARTINEZ" dos veces). Marcar todo eso como duplicado sería peor que no hacer
 * nada.
 *
 * Por eso el algoritmo es un **apareo greedy que respeta cantidades**: cada
 * transacción existente se "consume" como mucho una vez. Si la cuenta ya tiene
 * 16 movimientos de otro origen y el archivo trae 16, se marcan los 16. Si trae
 * 1, se marca 1. Si tiene 1 y trae 16, se marca 1 y los otros 15 son nuevos.
 *
 * ### Y por qué sólo contra OTRO origen
 *
 * Un extracto que lista dos veces un movimiento que pasó dos veces no es un
 * duplicado. El síntoma de duplicación es que el mismo movimiento entre por dos
 * archivos distintos, así que sólo se comparan las líneas contra transacciones
 * que NO vengan de este import.
 */

/** Tolerancia en días: distintas fuentes fechan el mismo movimiento con un día
 *  de corrimiento (visto en la reconciliación de junio 2026). */
export const DUPLICATE_DATE_TOLERANCE_DAYS = 1;

export type PendingLine = {
  id: string;
  /** `YYYY-MM-DD`. Una fecha ilegible nunca se marca como duplicada. */
  date: string | null | undefined;
  /** Monto como string decimal; el signo es irrelevante (lo da `kind`). */
  amount: string | null | undefined;
};

export type ExistingTx = {
  id: string;
  date: string;
  amount: string;
};

/**
 * Clave de comparación del monto: valor absoluto con 2 decimales. Se usa
 * `Decimal` y no `Number` porque acá el monto es dinero (regla de la casa: nada
 * de floats), y porque "1000.10" y "1000.1" tienen que dar la misma clave.
 * Devuelve null si el string no es un número válido.
 */
export function amountKey(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (s === '') return null;
  try {
    const d = new Decimal(s);
    if (!d.isFinite()) return null;
    return d.abs().toFixed(2);
  } catch {
    return null;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Días entre dos fechas ISO, sin pasar por husos horarios. */
function dayDiff(a: string, b: string): number {
  const ms = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))
    - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.abs(Math.round(ms / 86_400_000));
}

/**
 * Devuelve los ids de las líneas que ya existen como transacción.
 *
 * `existing` debe traer SOLO transacciones de la misma cuenta y de un origen
 * distinto al import en revisión — filtrarlas es responsabilidad del caller,
 * que es quien conoce la DB.
 *
 * El apareo es determinístico: las líneas se procesan en el orden recibido y,
 * entre varias transacciones candidatas, gana la de fecha más cercana (y a
 * igualdad, la de menor id). Así el resultado no cambia entre corridas.
 */
export function findAlreadyImported(
  lines: readonly PendingLine[],
  existing: readonly ExistingTx[],
  toleranceDays: number = DUPLICATE_DATE_TOLERANCE_DAYS,
): Set<string> {
  // Índice por monto → candidatas, para no recorrer todo por cada línea.
  const byAmount = new Map<string, ExistingTx[]>();
  for (const tx of existing) {
    const k = amountKey(tx.amount);
    if (k === null || !ISO_DATE.test(tx.date)) continue;
    const bucket = byAmount.get(k);
    if (bucket) bucket.push(tx);
    else byAmount.set(k, [tx]);
  }

  const consumed = new Set<string>();
  const flagged = new Set<string>();

  for (const line of lines) {
    const d = (line.date ?? '').trim();
    // Sin fecha legible no se puede afirmar nada: nunca se marca.
    if (!ISO_DATE.test(d)) continue;
    const k = amountKey(line.amount);
    if (k === null) continue;

    const candidates = byAmount.get(k);
    if (!candidates) continue;

    let best: ExistingTx | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const tx of candidates) {
      if (consumed.has(tx.id)) continue;
      const diff = dayDiff(d, tx.date);
      if (diff > toleranceDays) continue;
      if (diff < bestDiff || (diff === bestDiff && best !== null && tx.id < best.id)) {
        best = tx;
        bestDiff = diff;
      }
    }

    if (best) {
      consumed.add(best.id);
      flagged.add(line.id);
    }
  }

  return flagged;
}
