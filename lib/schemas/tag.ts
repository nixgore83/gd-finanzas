import { z } from 'zod';

/**
 * Tags son etiquetas libres m:n con transacciones. Ortogonales a categorías:
 * la categoría es un eje (income/expense), las tags son cortes arbitrarios.
 *
 * El schema de DB tiene `UNIQUE(household_id, name)` y NO tiene `archived` —
 * borrado es hard delete (CASCADE limpia `transaction_tags`).
 */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const tagInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'Nombre requerido' })
    .max(50, { message: 'Máximo 50 caracteres' }),
  color: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v, ctx) => {
      if (v === undefined || v === null) return null;
      const trimmed = v.trim();
      if (trimmed === '') return null;
      if (!HEX_RE.test(trimmed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Color inválido (#rrggbb)' });
        return z.NEVER;
      }
      return trimmed.toLowerCase();
    }),
});

export type TagInput = z.infer<typeof tagInputSchema>;

export function parseTagFormData(formData: FormData) {
  const colorRaw = formData.get('color');
  const wipeColor = formData.get('wipeColor') === '1';
  const color = wipeColor ? null : colorRaw;

  return tagInputSchema.safeParse({
    name: formData.get('name'),
    color,
  });
}

/**
 * Reusable: valida un array de tag UUIDs. Limita a 20 (sanity cap) y dedupea.
 * El cap es para evitar abuse via FormData manipulada; en UX normal el user
 * no tildaría 20 tags en una sola transacción.
 */
export const tagIdsSchema = z
  .array(z.string().uuid({ message: 'Tag inválido' }))
  .max(20, { message: 'Máximo 20 tags por transacción' })
  .transform((arr) => Array.from(new Set(arr)));
