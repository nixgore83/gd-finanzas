import { MAX_SORT_CRITERIA, type SortCriterion, type SortDir } from './criteria';

/**
 * Serializa criterios al formato de URL: `date:desc,amount:asc`.
 * Siempre con dirección explícita para que el parseo no dependa de defaults.
 */
export function serializeSort(criteria: readonly SortCriterion[]): string {
  return criteria.map((c) => `${c.field}:${c.dir}`).join(',');
}

function isSortDir(value: string): value is SortDir {
  return value === 'asc' || value === 'desc';
}

/**
 * Parsea el param `?sort=` a una lista de criterios validada.
 *
 * - Formato nuevo: `sort=date:desc,amount:asc`.
 * - Retrocompat con links viejos `?sort=date&dir=asc`: un único token sin `:`
 *   toma la dirección de `legacyDir` (el viejo param `dir`) o, si falta/es
 *   inválida, de `legacyDefaultDir` — que en las páginas existentes es `desc`.
 * - Campos fuera de `allowed` se descartan; duplicados se dedupean (gana la
 *   primera aparición); tokens con dirección inválida (`date:up`) se descartan;
 *   se trunca a MAX_SORT_CRITERIA. Si no sobrevive ningún criterio → `fallback`.
 */
export function parseSortParam<F extends string>(
  raw: string | undefined,
  legacyDir: string | undefined,
  opts: {
    allowed: readonly F[];
    fallback: readonly SortCriterion<F>[];
    legacyDefaultDir: SortDir;
  },
): SortCriterion<F>[] {
  const fallback = () => opts.fallback.map((c) => ({ ...c }));
  if (!raw) return fallback();

  const isAllowed = (field: string): field is F =>
    (opts.allowed as readonly string[]).includes(field);

  const tokens = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const out: SortCriterion<F>[] = [];
  const seen = new Set<string>();
  const legacySingle = tokens.length === 1 && !tokens[0]!.includes(':');

  for (const token of tokens) {
    const [field, dirRaw, ...rest] = token.split(':');
    if (!field || rest.length > 0 || !isAllowed(field) || seen.has(field)) continue;
    let dir: SortDir;
    if (dirRaw === undefined) {
      if (!legacySingle) continue; // `a,b` sin dir solo se tolera en formato legacy (1 token)
      dir = legacyDir && isSortDir(legacyDir) ? legacyDir : opts.legacyDefaultDir;
    } else {
      if (!isSortDir(dirRaw)) continue;
      dir = dirRaw;
    }
    seen.add(field);
    out.push({ field, dir });
    if (out.length >= MAX_SORT_CRITERIA) break;
  }

  return out.length > 0 ? out : fallback();
}
