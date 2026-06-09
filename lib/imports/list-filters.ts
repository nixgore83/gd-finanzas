// Helpers puros para la lista de imports: estados, tabs (views) y borrabilidad.
// Sin dependencias de DB → testeable y reusable por la página, la tabla y el action de delete.

export const IMPORT_STATUSES = [
  'uploaded',
  'parsing',
  'parsed',
  'reviewing',
  'confirmed',
  'error',
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  uploaded: 'Subido',
  parsing: 'Parseando',
  parsed: 'Revisar',
  reviewing: 'En revisión',
  confirmed: 'Confirmado',
  error: 'Error',
};

export const IMPORT_STATUS_VARS: Record<ImportStatus, string> = {
  uploaded: 'var(--muted-foreground)',
  parsing: 'var(--attn)',
  parsed: 'var(--attn)',
  reviewing: 'var(--attn)',
  confirmed: 'var(--good)',
  error: 'var(--bad)',
};

export const IMPORT_VIEWS = ['all', 'review', 'confirmed', 'error'] as const;
export type ImportView = (typeof IMPORT_VIEWS)[number];

export const IMPORT_VIEW_LABELS: Record<ImportView, string> = {
  all: 'Todos',
  review: 'Para revisar',
  confirmed: 'Confirmados',
  error: 'Error',
};

/**
 * Statuses que cubre cada tab. `null` = sin filtro (todos).
 * `review` = todo lo que espera acción del usuario: cualquier estado que no sea
 * terminal (`confirmed`) ni `error` (incluye uploaded/parsing/parsed/reviewing).
 */
export function viewToStatuses(view: ImportView): ImportStatus[] | null {
  switch (view) {
    case 'review':
      return IMPORT_STATUSES.filter((s) => s !== 'confirmed' && s !== 'error');
    case 'confirmed':
      return ['confirmed'];
    case 'error':
      return ['error'];
    case 'all':
    default:
      return null;
  }
}

/**
 * Solo borrables los imports que nunca crearon transacciones. `confirmed` y
 * `reviewing` (que puede tener confirmaciones parciales) se excluyen para no
 * dejar transacciones huérfanas con `import_batch_id`.
 */
export const DELETABLE_STATUSES: readonly ImportStatus[] = [
  'uploaded',
  'parsing',
  'parsed',
  'error',
];

export function isDeletableStatus(status: string): boolean {
  return (DELETABLE_STATUSES as readonly string[]).includes(status);
}
