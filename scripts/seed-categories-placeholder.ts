import postgres from 'postgres';
import { loadEnv } from './_env';

/**
 * Seed placeholder de 2 categorías por household: "Ingresos varios" (income) y
 * "Gastos varios" (expense). Destraba Hito 3.A sin comprometer la taxonomía
 * real (esa se cierra con Nico/Pau antes del Hito 4).
 *
 * Idempotente: usa `WHERE NOT EXISTS` por nombre + household. La tabla
 * `categories` no tiene UNIQUE (household_id, name), así que el guard vive acá.
 *
 * Uso: npm run db:seed:categories-placeholder
 */

const PLACEHOLDERS: { name: string; kind: 'income' | 'expense' }[] = [
  { name: 'Ingresos varios', kind: 'income' },
  { name: 'Gastos varios', kind: 'expense' },
];

async function main() {
  loadEnv();

  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) throw new Error('DIRECT_URL must be set');

  const sql = postgres(directUrl, { max: 1 });

  try {
    const households = await sql<{ id: string }[]>`select id from public.households`;
    if (households.length === 0) {
      console.warn('[seed-categories-placeholder] no hay households — corré db:seed:household primero');
      return;
    }

    let inserted = 0;
    let existed = 0;
    for (const h of households) {
      for (const cat of PLACEHOLDERS) {
        const result = await sql<{ id: string }[]>`
          insert into public.categories (household_id, name, kind)
          select ${h.id}, ${cat.name}, ${cat.kind}
          where not exists (
            select 1 from public.categories
            where household_id = ${h.id} and name = ${cat.name}
          )
          returning id
        `;
        if (result.length > 0) inserted++;
        else existed++;
      }
    }

    console.warn(
      `[seed-categories-placeholder] ${households.length} households × ${PLACEHOLDERS.length} cats — ${inserted} insertadas, ${existed} ya existían`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('[seed-categories-placeholder] failed:', err);
  process.exit(1);
});
