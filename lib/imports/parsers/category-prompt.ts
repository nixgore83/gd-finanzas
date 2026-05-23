import type { CategoryNode } from '@/lib/categories/tree';

/**
 * Genera el bloque de prompt que le pide al LLM sugerir categoría para cada
 * línea, dada la lista de categorías del household.
 */
export function buildCategoryPromptBlock(tree: CategoryNode[]): string {
  const lines: string[] = [];
  for (const node of tree) {
    const prefix = node.depth === 1 ? '  - ' : '- ';
    lines.push(`${prefix}${node.name} (${node.kind})`);
  }

  return `
CATEGORIZACIÓN — campo OPCIONAL "suggestedCategory":
Para cada línea, si reconocés el comercio o concepto, incluí un campo "suggestedCategory" con el NOMBRE EXACTO de la categoría más apropiada de esta lista:

${lines.join('\n')}

Reglas:
- Usá SOLO nombres de la lista. Si no reconocés el comercio, NO incluyas el campo.
- Priorizá categorías hoja (indentadas con "  - ") sobre las padre.
- Ejemplos: estaciones de servicio (YPF, Shell, Axion) → Combustible; supermercados (Coto, Jumbo, Carrefour) → Supermercado; farmacias → Farmacia; streaming (Netflix, Spotify, Disney+) → Suscripciones streaming; plataformas IA (ChatGPT, Claude) → Suscripciones IA.
- Este campo es solo una sugerencia. El usuario siempre revisa y puede cambiarla.`;
}
