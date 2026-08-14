/**
 * Asignación EN BLOQUE de la cuenta contraparte de una transferencia
 * (`import_lines.parsed_data.transferAccountId`).
 *
 * Todo acá es PURO: el server action lo usa para armar el patch jsonb y la UI de
 * revisión para armar el selector y el resumen de la selección. Sin DB, testeable.
 *
 * ### Por qué la selección PUEDE mezclar ingresos y gastos
 *
 * El bulk de **categoría** exige `kind` uniforme, y ahí la restricción es
 * correcta: una categoría es de ingreso o de gasto, nunca de las dos.
 *
 * La cuenta contraparte NO funciona así. `transferAccountId` es "la otra cuenta"
 * del traspaso; la DIRECCIÓN la aporta el `kind` de cada línea (un gasto sale
 * hacia esa cuenta, un ingreso viene de ella). La misma contraparte sirve para
 * las dos. Caso real que motivó esto: en la caja de ahorro Galicia de Pau hay 11
 * líneas contra su cuenta BIND en pesos — 10 ingresos ("TRANSFERENCIA DE CUENTA
 * PROPIA") y 1 gasto ("TRANSF. CTAS PROPIAS"). Obligar a filtrar por tipo antes
 * partiría en dos un grupo que es uno solo. Heredar el `uniformKind` del bulk de
 * categoría sería un bug, no una salvaguarda.
 */

/** `set` asigna la contraparte; `clear` la borra (la línea sigue siendo transfer). */
export type TransferAccountBulkAction =
  | { op: 'set'; transferAccountId: string }
  | { op: 'clear' };

export type TransferAccountPatch = {
  /** Claves a mergear (shallow) sobre `parsed_data`. */
  merge: Record<string, string | boolean>;
  /** Claves a borrar de `parsed_data`. */
  remove: readonly string[];
};

/**
 * Patch a aplicar sobre `parsed_data`. Fuente de verdad de la semántica; el
 * action lo traduce a `parsed_data || <merge>::jsonb - <remove>`.
 *
 * Reglas de negocio:
 * - Asignar contraparte implica `isTransfer: true` — una línea con contraparte
 *   pero sin marcar como transferencia es un estado incoherente. (La limpieza de
 *   la categoría propuesta no va en el jsonb: es la columna `proposed_category_id`
 *   y la hace el action.)
 * - Quitar la contraparte BORRA la clave (no la deja en `null`) y NO toca
 *   `isTransfer`: "no tengo la contracuenta todavía" y "no es transferencia" son
 *   cosas distintas — para lo segundo ya está `bulkSetTransfer(false)`.
 */
export function transferAccountPatch(action: TransferAccountBulkAction): TransferAccountPatch {
  if (action.op === 'clear') {
    return { merge: {}, remove: ['transferAccountId'] };
  }
  return {
    merge: { isTransfer: true, transferAccountId: action.transferAccountId },
    remove: [],
  };
}

/**
 * Cuentas ofrecibles como contraparte: todas menos la propia del extracto. Una
 * transferencia de una cuenta a sí misma no existe, así que ofrecerla solo
 * habilita cargar basura.
 */
export function counterpartyAccountOptions<T extends { id: string }>(
  allAccounts: readonly T[],
  ownAccountId: string | null | undefined,
): T[] {
  return allAccounts.filter((a) => a.id !== ownAccountId);
}

export type BulkTransferAccountSelection = {
  /** Ids que el bulk va a tocar. Son TODOS: no hay filtro por `kind`. */
  ids: string[];
  incomeCount: number;
  expenseCount: number;
  /** La selección mezcla ingresos y gastos. Permitido a propósito (ver doc arriba). */
  mixedKinds: boolean;
};

/**
 * Resumen de la selección para el bulk de contracuenta. Existe para dejar la
 * regla escrita y cubierta por tests: si alguien alguna vez le agrega un filtro
 * por `kind`, el test del caso mixto falla.
 */
export function bulkTransferAccountSelection(
  lines: ReadonlyArray<{ id: string; kind: 'income' | 'expense' }>,
): BulkTransferAccountSelection {
  let incomeCount = 0;
  let expenseCount = 0;
  for (const l of lines) {
    if (l.kind === 'income') incomeCount += 1;
    else expenseCount += 1;
  }
  return {
    ids: lines.map((l) => l.id),
    incomeCount,
    expenseCount,
    mixedKinds: incomeCount > 0 && expenseCount > 0,
  };
}
