import type { ParsedTxLine } from './parsers/types';

/**
 * Conceptos que NUNCA son una transferencia entre cuentas propias, por más que
 * el parser o los patrones de abajo digan lo contrario. Se evalúan PRIMERO y
 * mandan sobre `isTransfer`.
 *
 * Hoy sólo el pago con QR: "PAGO C/TF QR <nombre>" es una compra a un comercio o
 * persona — el nombre del beneficiario viene en la propia descripción. Marcarlo
 * como transferencia lo saca del cálculo de gastos, que es justo lo contrario de
 * lo que corresponde.
 *
 * El listón para entrar acá es alto: el concepto tiene que ser incompatible con
 * un movimiento interno *por definición*, no sólo "en general no lo es". Por eso
 * DEBIN NO está — ver el comentario en TRANSFER_PATTERNS.
 */
const NOT_TRANSFER_PATTERNS = [/\bPAGO\s*C\/TF\s*QR\b/i, /\bPAGO\s+QR\b/i];

/**
 * Patrones que sugieren fuertemente que una línea es una transferencia entre
 * cuentas propias. Match parcial, case-insensitive, sobre la descripción.
 *
 * Ojo con agrandar esta lista: un falso positivo acá saca un gasto real del
 * reporte, y sale caro de deshacer. En la revisión de agosto 2026, de 521 líneas
 * marcadas como transferencia sin contracuenta, ~155 tenían de contraparte a un
 * tercero — o sea eran gastos o ingresos reales mal clasificados.
 *
 * `DEBIN` estuvo acá y se sacó (2026-08-14). El Débito Inmediato es un
 * INSTRUMENTO de pago, no evidencia de que el dinero se mueva entre cuentas
 * propias: se usa tanto para que un comercio te cobre como para fondear tu
 * cuenta de broker desde tu propio banco. Como la descripción sola no distingue
 * los dos casos, la decisión queda en manos del parser LLM, que sí ve la
 * contraparte y la sección del extracto. Sacarlo no fuerza nada: sólo deja de
 * marcar por regex lo que no se puede afirmar por regex.
 */
const TRANSFER_PATTERNS = [
  /\bTRANSF\b/i,
  /\bTRF\b/i,
  /\bTRANSFERENCIA\b/i,
  /\bTRANSFER\b/i,
  /\bCTA\s*PROPIA/i,
  /\bENTRE\s*CUENTAS/i,
];

/** ¿El concepto es incompatible con una transferencia entre cuentas propias? */
export function isNeverTransfer(description: string): boolean {
  return NOT_TRANSFER_PATTERNS.some((p) => p.test(description));
}

/**
 * Pasada post-parseo: marca `isTransfer: true` cuando la descripción matchea un
 * patrón de transferencia, y lo fuerza a `false` cuando matchea un concepto que
 * nunca puede serlo.
 *
 * Fuera de esos dos casos NO pisa lo que decidió el parser: si el LLM marcó una
 * línea como transferencia, se respeta — tiene más contexto que un regex sobre
 * la descripción (ve la contraparte, la sección del extracto, el signo).
 *
 * Devuelve un array nuevo (no muta la entrada).
 */
export function detectTransfers(lines: ParsedTxLine[]): ParsedTxLine[] {
  return lines.map((line) => {
    // La exclusión manda, incluso sobre el parser.
    if (isNeverTransfer(line.description)) {
      return line.isTransfer ? { ...line, isTransfer: false } : line;
    }
    if (line.isTransfer) return line;
    const matches = TRANSFER_PATTERNS.some((p) => p.test(line.description));
    if (!matches) return line;
    return { ...line, isTransfer: true };
  });
}
