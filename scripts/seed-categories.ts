import postgres from 'postgres';
import { loadEnv } from './_env';

/**
 * Seed de la taxonomía real de categorías (cerrada con Nico, 2026-05-22).
 * Idempotente: si una categoría ya existe por (household_id, name, kind)
 * la skipea.
 *
 * Migración: si existen las placeholder "Ingresos varios" / "Gastos varios"
 * (sembradas por `db:seed:categories-placeholder` durante Hito 3.A), reapunta
 * sus transacciones a "Otros ingresos" / "Otros gastos" antes de borrarlas.
 *
 * Uso: npm run db:seed:categories
 */

type Cat = {
  name: string;
  color: string | null;
  icon: string | null;
  children?: string[];
};

const INCOME: Cat[] = [
  {
    name: 'Sueldo',
    color: '#10b981',
    icon: 'Briefcase',
    children: ['Sueldo Nico', 'Sueldo Pau'],
  },
  {
    name: 'Inversiones',
    color: '#059669',
    icon: 'TrendingUp',
    children: ['Alquiler', 'Dividendos', 'Intereses', 'Ganancia capital'],
  },
  { name: 'Otros ingresos', color: '#047857', icon: 'PlusCircle' },
];

const EXPENSE: Cat[] = [
  {
    name: 'Vivienda',
    color: '#6366f1',
    icon: 'Home',
    children: ['Alquiler', 'Expensas', 'Servicios (luz, gas, agua, internet)', 'Mantenimiento'],
  },
  {
    name: 'Alimentación',
    color: '#f97316',
    icon: 'UtensilsCrossed',
    children: ['Supermercado', 'Restaurantes'],
  },
  {
    name: 'Transporte',
    color: '#06b6d4',
    icon: 'Car',
    children: ['Combustible', 'Peajes / estacionamiento', 'Transporte público, Uber / taxi'],
  },
  {
    name: 'Salud',
    color: '#ef4444',
    icon: 'HeartPulse',
    children: ['Obra social / prepaga', 'Médicos / estudios', 'Farmacia'],
  },
  {
    name: 'Educación',
    color: '#8b5cf6',
    icon: 'GraduationCap',
    children: ['Colegio', 'Cursos / libros'],
  },
  {
    name: 'Hijos',
    color: '#ec4899',
    icon: 'Baby',
    children: ['Actividades', 'Viajes de estudio'],
  },
  { name: 'Vacaciones', color: '#14b8a6', icon: 'Plane' },
  {
    name: 'Personales',
    color: '#64748b',
    icon: 'Shirt',
    children: ['Regalos', 'Suscripciones streaming', 'Suscripciones IA', 'Varios'],
  },
  {
    name: 'Impuestos',
    color: '#f59e0b',
    icon: 'Landmark',
    children: ['Monotributo', 'Bienes Personales', 'Ganancias', 'Autónomos'],
  },
  {
    name: 'Inversiones',
    color: '#3b82f6',
    icon: 'TrendingUp',
    children: ['Rabbit Hole', 'Tijeritas'],
  },
  { name: 'Mario', color: '#d97706', icon: 'Heart' },
  { name: 'Impresión 3D', color: '#a855f7', icon: 'Printer' },
  { name: 'Gastos bancarios', color: '#78716c', icon: 'Building' },
  { name: 'Seguros', color: '#0ea5e9', icon: 'Shield' },
  { name: 'Otros gastos', color: '#71717a', icon: 'MinusCircle' },
];

async function main() {
  loadEnv();
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) throw new Error('DIRECT_URL must be set');

  const sql = postgres(directUrl, { max: 1 });

  try {
    const households = await sql<{ id: string }[]>`select id from public.households`;
    if (households.length === 0) {
      console.warn('[seed-categories] no hay households — corré db:seed:household primero');
      return;
    }

    let parentsInserted = 0;
    let childrenInserted = 0;
    let txMigrated = 0;
    let placeholdersDeleted = 0;

    for (const h of households) {
      const parentByKey = new Map<string, string>();

      // 1) Parents (income + expense)
      for (const kind of ['income', 'expense'] as const) {
        const list = kind === 'income' ? INCOME : EXPENSE;
        for (const p of list) {
          const existing = await sql<{ id: string }[]>`
            select id from public.categories
            where household_id = ${h.id} and name = ${p.name} and kind = ${kind} and parent_id is null
            limit 1
          `;
          if (existing[0]) {
            parentByKey.set(`${kind}:${p.name}`, existing[0].id);
            continue;
          }
          const inserted = await sql<{ id: string }[]>`
            insert into public.categories (household_id, name, kind, color, icon)
            values (${h.id}, ${p.name}, ${kind}, ${p.color}, ${p.icon})
            returning id
          `;
          if (!inserted[0]) throw new Error(`insert parent failed: ${p.name}`);
          parentByKey.set(`${kind}:${p.name}`, inserted[0].id);
          parentsInserted++;
        }
      }

      // 2) Children — heredan kind del padre
      for (const kind of ['income', 'expense'] as const) {
        const list = kind === 'income' ? INCOME : EXPENSE;
        for (const p of list) {
          if (!p.children) continue;
          const parentId = parentByKey.get(`${kind}:${p.name}`);
          if (!parentId) throw new Error(`parent id missing for ${kind}:${p.name}`);
          for (const childName of p.children) {
            const existing = await sql<{ id: string }[]>`
              select id from public.categories
              where household_id = ${h.id} and name = ${childName} and parent_id = ${parentId}
              limit 1
            `;
            if (existing[0]) continue;
            await sql`
              insert into public.categories (household_id, name, kind, parent_id)
              values (${h.id}, ${childName}, ${kind}, ${parentId})
            `;
            childrenInserted++;
          }
        }
      }

      // 3) Migración de placeholders → "Otros ..." (kind-matched)
      const otrosIngresosId = parentByKey.get('income:Otros ingresos');
      const otrosGastosId = parentByKey.get('expense:Otros gastos');

      const [ingresosVarios] = await sql<{ id: string }[]>`
        select id from public.categories
        where household_id = ${h.id} and name = 'Ingresos varios' and kind = 'income'
        limit 1
      `;
      const [gastosVarios] = await sql<{ id: string }[]>`
        select id from public.categories
        where household_id = ${h.id} and name = 'Gastos varios' and kind = 'expense'
        limit 1
      `;

      if (ingresosVarios && otrosIngresosId) {
        const r = await sql`
          update public.transactions
          set category_id = ${otrosIngresosId}
          where household_id = ${h.id} and category_id = ${ingresosVarios.id}
        `;
        txMigrated += r.count;
      }
      if (gastosVarios && otrosGastosId) {
        const r = await sql`
          update public.transactions
          set category_id = ${otrosGastosId}
          where household_id = ${h.id} and category_id = ${gastosVarios.id}
        `;
        txMigrated += r.count;
      }

      const del = await sql`
        delete from public.categories
        where household_id = ${h.id} and name in ('Ingresos varios', 'Gastos varios')
      `;
      placeholdersDeleted += del.count;
    }

    console.warn(
      `[seed-categories] ${parentsInserted} parents + ${childrenInserted} children insertadas — ${txMigrated} txs migradas — ${placeholdersDeleted} placeholders borradas`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('[seed-categories] failed:', err);
  process.exit(1);
});
