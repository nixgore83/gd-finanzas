import postgres from 'postgres';
import { loadEnv } from './_env';

/**
 * Seed de recurrencias fijas (cerrado con Nico, 2026-05-23).
 * Solo items con cuenta y día fijos. El resto se cubre via budget.
 *
 * Idempotente: skipea si ya existe (household_id, name).
 *
 * Uso: npm run db:seed:recurrences
 */

type Rec = {
  name: string;
  kind: 'income' | 'expense';
  amount: number; // ARS
  categoryName: string;
  categoryParent: string | null;
  accountName: string;
  accountOwner: string;
  dayOfMonth: number;
  frequency: 'monthly';
};

const FX = 1400;

const RECURRENCES: Rec[] = [
  {
    name: 'Sueldo Nico',
    kind: 'income',
    amount: 10357 * FX,
    categoryName: 'Sueldo Nico',
    categoryParent: 'Sueldo',
    accountName: 'ICBC Caja Ahorro',
    accountOwner: 'Nico',
    dayOfMonth: 1,
    frequency: 'monthly',
  },
  {
    name: 'Sueldo Pau',
    kind: 'income',
    amount: 4500 * FX,
    categoryName: 'Sueldo Pau',
    categoryParent: 'Sueldo',
    accountName: 'Galicia Caja Ahorro',
    accountOwner: 'Pau',
    dayOfMonth: 1,
    frequency: 'monthly',
  },
  {
    name: 'Alquiler Marconi',
    kind: 'income',
    amount: 1018 * FX,
    categoryName: 'Alquiler',
    categoryParent: 'Inversiones',
    accountName: 'ICBC Caja Ahorro',
    accountOwner: 'Nico',
    dayOfMonth: 10,
    frequency: 'monthly',
  },
  {
    name: 'Expensas',
    kind: 'expense',
    amount: 500 * FX,
    categoryName: 'Expensas',
    categoryParent: 'Vivienda',
    accountName: 'ICBC Caja Ahorro',
    accountOwner: 'Nico',
    dayOfMonth: 14,
    frequency: 'monthly',
  },
  {
    name: 'Nahir',
    kind: 'expense',
    amount: 800 * FX,
    categoryName: 'Mantenimiento',
    categoryParent: 'Vivienda',
    accountName: 'Galicia Caja Ahorro',
    accountOwner: 'Pau',
    dayOfMonth: 3,
    frequency: 'monthly',
  },
  {
    name: 'Sworn',
    kind: 'expense',
    amount: 1000 * FX,
    categoryName: 'Colegio',
    categoryParent: 'Educación',
    accountName: 'ICBC Caja Ahorro',
    accountOwner: 'Nico',
    dayOfMonth: 3,
    frequency: 'monthly',
  },
  {
    name: 'St Johns',
    kind: 'expense',
    amount: 500 * FX,
    categoryName: 'Colegio',
    categoryParent: 'Educación',
    accountName: 'Galicia Caja Ahorro',
    accountOwner: 'Pau',
    dayOfMonth: 3,
    frequency: 'monthly',
  },
];

async function main() {
  loadEnv();
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) throw new Error('DIRECT_URL must be set');

  const sql = postgres(directUrl, { max: 1 });

  try {
    const households = await sql<{ id: string }[]>`select id from public.households`;
    if (households.length !== 1) {
      console.warn(`[seed-recurrences] expected 1 household, got ${households.length}. Aborting.`);
      return;
    }
    const hhId = households[0]!.id;

    // Load categories
    const cats = await sql<{ id: string; name: string; kind: string; parentName: string | null }[]>`
      select c.id, c.name, c.kind::text, p.name as "parentName"
      from public.categories c
      left join public.categories p on p.id = c.parent_id
      where c.household_id = ${hhId}
    `;

    // Load accounts
    const accts = await sql<{ id: string; name: string; ownerTag: string }[]>`
      select id, name, owner_tag as "ownerTag"
      from public.accounts
      where household_id = ${hhId}
    `;

    let inserted = 0;
    let skipped = 0;

    for (const rec of RECURRENCES) {
      // Check idempotency
      const existing = await sql<{ id: string }[]>`
        select id from public.recurrences
        where household_id = ${hhId} and name = ${rec.name}
        limit 1
      `;
      if (existing[0]) {
        skipped++;
        continue;
      }

      // Find category
      const cat = cats.find(
        (c) => c.name === rec.categoryName && c.kind === rec.kind &&
          (rec.categoryParent === null || c.parentName === rec.categoryParent),
      );
      if (!cat) {
        console.error(`[seed-recurrences] ❌ categoría no encontrada: "${rec.categoryName}" (${rec.kind}, parent="${rec.categoryParent}")`);
        continue;
      }

      // Find account
      const acct = accts.find(
        (a) => a.name === rec.accountName && a.ownerTag === rec.accountOwner,
      );
      if (!acct) {
        console.error(`[seed-recurrences] ❌ cuenta no encontrada: "${rec.accountName}" (owner="${rec.accountOwner}")`);
        continue;
      }

      await sql`
        insert into public.recurrences (
          household_id, name, account_id, category_id, kind,
          amount, currency, frequency, day_of_month,
          start_date, active
        ) values (
          ${hhId}, ${rec.name}, ${acct.id}, ${cat.id}, ${rec.kind},
          ${rec.amount.toFixed(2)}, 'ARS', ${rec.frequency}, ${rec.dayOfMonth},
          '2026-01-01', true
        )
      `;
      inserted++;
    }

    console.warn(`[seed-recurrences] ${inserted} recurrencias creadas, ${skipped} ya existían`);

    // Now sync forecasts for all newly created recurrences
    // We need to generate forecasts rolling 12 months from today
    if (inserted > 0) {
      const recs = await sql<{ id: string; name: string }[]>`
        select id, name from public.recurrences
        where household_id = ${hhId}
      `;

      let forecastCount = 0;
      const today = new Date();

      for (const r of recs) {
        // Check if forecasts already exist
        const existing = await sql<{ n: number }[]>`
          select count(*)::int as n from public.forecasts
          where recurrence_id = ${r.id} and status = 'pending'
        `;
        if (existing[0] && existing[0].n > 0) continue;

        // Generate 12 months of forecasts from today
        for (let i = 0; i < 12; i++) {
          const recRow = await sql<{
            dayOfMonth: number; amount: string; currency: string;
            startDate: string; endDate: string | null;
          }[]>`
            select day_of_month as "dayOfMonth", amount::text, currency,
                   start_date::text as "startDate", end_date::text as "endDate"
            from public.recurrences where id = ${r.id}
          `;
          if (!recRow[0]) continue;

          const d = recRow[0];
          const month = new Date(today.getFullYear(), today.getMonth() + i, 1);
          const year = month.getFullYear();
          const mon = month.getMonth(); // 0-based
          // Clamp day to last day of month
          const lastDay = new Date(year, mon + 1, 0).getDate();
          const day = Math.min(d.dayOfMonth, lastDay);
          const expectedDate = `${year}-${String(mon + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

          // Skip if before start_date
          if (expectedDate < d.startDate) continue;
          // Skip if after end_date
          if (d.endDate && expectedDate > d.endDate) continue;
          // Skip if in the past
          const todayStr = today.toISOString().slice(0, 10);
          if (expectedDate < todayStr) continue;

          await sql`
            insert into public.forecasts (
              recurrence_id, expected_date, expected_amount, currency, status
            ) values (
              ${r.id}, ${expectedDate}, ${d.amount}, ${d.currency}, 'pending'
            )
          `;
          forecastCount++;
        }
      }
      console.warn(`[seed-recurrences] ${forecastCount} forecasts generados`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('[seed-recurrences] failed:', err);
  process.exit(1);
});
