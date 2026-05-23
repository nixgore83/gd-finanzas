import postgres from 'postgres';
import { loadEnv } from './_env';

/**
 * Carga masiva del presupuesto 2026 desde el Excel "Presupuesto anual 2026"
 * de Google Drive. Mapeo cerrado con Nico el 2026-05-23.
 *
 * Idempotente: UPSERT por (household_id, year, month, category_id).
 *
 * Uso: npm run db:seed:budget-2026
 */

const YEAR = 2026;

// Budget entries: [categoryName, parentName | null, kind, monthlyAmounts (ene..dic)]
// parentName disambiguates when the same name exists under different parents/kinds
// (e.g. "Alquiler" exists in income and expense)
type BudgetLine = {
  category: string;
  parent: string | null;
  kind: 'income' | 'expense';
  months: [number, number, number, number, number, number, number, number, number, number, number, number];
};

const BUDGET: BudgetLine[] = [
  // ── Income ──────────────────────────────────────────────────────
  // Sueldo Nico (real ene-mar, proyectado abr-dic)
  { category: 'Sueldo Nico', parent: 'Sueldo', kind: 'income',
    months: [8951, 10184, 11008, 10357, 10357, 10357, 10357, 10357, 10357, 10357, 10357, 10357] },
  // Sueldo Pau
  { category: 'Sueldo Pau', parent: 'Sueldo', kind: 'income',
    months: [2823, 4914, 4644, 4500, 4500, 4500, 4500, 4500, 4500, 4500, 4500, 3000] },
  // Alquiler Marconi
  { category: 'Alquiler', parent: 'Inversiones', kind: 'income',
    months: [767, 1018, 1018, 1018, 1018, 1018, 1018, 1018, 1018, 1018, 1018, 1018] },
  // Tijeritas
  { category: 'Otros ingresos', parent: null, kind: 'income',
    months: [0, 0, 0, 0, 0, 0, 1000, 1000, 1000, 2000, 2000, 2000] },

  // ── Expense: Vivienda ───────────────────────────────────────────
  // Alquiler departamento
  { category: 'Alquiler', parent: 'Vivienda', kind: 'expense',
    months: [1800, 1800, 1800, 1800, 1800, 1800, 1800, 1800, 1800, 1800, 1800, 1800] },
  // Expensas
  { category: 'Expensas', parent: 'Vivienda', kind: 'expense',
    months: [500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500] },
  // Servicios (Internet $37 + Electricidad $77 + Gas $80 + ABL $32 = $226)
  { category: 'Servicios (luz, gas, agua, internet)', parent: 'Vivienda', kind: 'expense',
    months: [226, 226, 226, 226, 226, 226, 226, 226, 226, 226, 226, 226] },
  // Mantenimiento = Muebles $50 + Césped $45 + Manto $50 + Mejoras $50
  //               + Impuestos propiedad $50 + Nahir $800 = $1,045
  { category: 'Mantenimiento', parent: 'Vivienda', kind: 'expense',
    months: [1045, 1045, 1045, 1045, 1045, 1045, 1045, 1045, 1045, 1045, 1045, 1045] },

  // ── Expense: Alimentación ───────────────────────────────────────
  { category: 'Supermercado', parent: 'Alimentación', kind: 'expense',
    months: [1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500] },
  { category: 'Restaurantes', parent: 'Alimentación', kind: 'expense',
    months: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100] },

  // ── Expense: Transporte (todo auto) ─────────────────────────────
  // Seguros $500 + Nafta $100 + Arreglos $30 + Cuotas $519 = $1,149 base
  // + Patente $667 en ene, mar, may, jul, sep
  { category: 'Combustible', parent: 'Transporte', kind: 'expense',
    months: [1816, 1149, 1816, 1149, 1816, 1149, 1816, 1149, 1816, 1149, 1149, 1149] },

  // ── Expense: Educación ──────────────────────────────────────────
  // Colegio = St Johns $1,000 + Sworn $500 = $1,500
  { category: 'Colegio', parent: 'Educación', kind: 'expense',
    months: [1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500] },
  // Libros y uniforme: $500 ene + $500 jul
  { category: 'Cursos / libros', parent: 'Educación', kind: 'expense',
    months: [500, 0, 0, 0, 0, 0, 500, 0, 0, 0, 0, 0] },

  // ── Expense: Hijos ──────────────────────────────────────────────
  // Actividades = Actividades Chicos $200 + Clau $800 + Colonia variable
  // Colonia: $400 ene, $200 jun
  { category: 'Actividades', parent: 'Hijos', kind: 'expense',
    months: [1400, 1000, 1000, 1000, 1000, 1200, 1000, 1000, 1000, 1000, 1000, 1000] },

  // ── Expense: Vacaciones (hoja) ──────────────────────────────────
  { category: 'Vacaciones', parent: null, kind: 'expense',
    months: [1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500] },

  // ── Expense: Personales ─────────────────────────────────────────
  // Regalos: $150/mo
  { category: 'Regalos', parent: 'Personales', kind: 'expense',
    months: [150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150] },
  // Varios = Ropa $200 + Suscripciones $100 + Juguetes $200 = $500
  { category: 'Varios', parent: 'Personales', kind: 'expense',
    months: [500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500] },
];

async function main() {
  loadEnv();
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) throw new Error('DIRECT_URL must be set');

  const sql = postgres(directUrl, { max: 1 });

  try {
    const households = await sql<{ id: string }[]>`select id from public.households`;
    if (households.length !== 1) {
      console.warn(`[seed-budget] expected 1 household, got ${households.length}. Aborting.`);
      return;
    }
    const hhId = households[0]!.id;

    // Load all categories for this household
    const cats = await sql<{ id: string; name: string; kind: string; parentId: string | null; parentName: string | null }[]>`
      select c.id, c.name, c.kind::text,
             c.parent_id as "parentId",
             p.name as "parentName"
      from public.categories c
      left join public.categories p on p.id = c.parent_id
      where c.household_id = ${hhId}
    `;

    let upserted = 0;
    let skippedZero = 0;

    for (const line of BUDGET) {
      // Find the category: match by name + kind + parent name (if specified)
      const matches = cats.filter((c) => {
        if (c.name !== line.category || c.kind !== line.kind) return false;
        if (line.parent !== null && c.parentName !== line.parent) return false;
        return true;
      });

      if (matches.length === 0) {
        console.error(`[seed-budget] ❌ categoría no encontrada: "${line.category}" (${line.kind}, parent="${line.parent}")`);
        continue;
      }
      if (matches.length > 1) {
        console.error(`[seed-budget] ❌ múltiples matches para "${line.category}" (${line.kind}): ${matches.map((m) => m.id).join(', ')}`);
        continue;
      }

      const catId = matches[0]!.id;

      for (let m = 0; m < 12; m++) {
        const amount = line.months[m]!;
        if (amount === 0) {
          skippedZero++;
          continue;
        }
        const month = m + 1;
        await sql`
          insert into public.budgets (household_id, year, month, category_id, amount_usd, revision_at)
          values (${hhId}, ${YEAR}, ${month}, ${catId}, ${amount.toFixed(2)}, now())
          on conflict (household_id, year, month, category_id)
          do update set amount_usd = excluded.amount_usd, revision_at = now()
        `;
        upserted++;
      }
    }

    console.warn(`[seed-budget] ${upserted} entradas upserted, ${skippedZero} meses en $0 skipped`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('[seed-budget] failed:', err);
  process.exit(1);
});
