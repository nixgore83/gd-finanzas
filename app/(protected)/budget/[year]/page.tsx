import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { budgets } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadCategoryTree } from '@/lib/categories/tree';
import { BudgetGrid } from '../budget-grid';

export const metadata = {
  title: 'Presupuesto · gd-finanzas',
};

const yearSchema = z.coerce.number().int().min(2020).max(2100);

type RouteParams = Promise<{ year: string }>;

export default async function BudgetYearPage({ params }: { params: RouteParams }) {
  const { year: yearRaw } = await params;
  const yearParsed = yearSchema.safeParse(yearRaw);
  if (!yearParsed.success) notFound();
  const year = yearParsed.data;

  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const db = getDb();
  const categories = await loadCategoryTree(session.householdId);

  if (categories.length === 0) {
    return (
      <div className="mx-auto max-w-xl space-y-4 rounded-md border border-dashed p-8 text-center">
        <h2 className="text-lg font-medium">No hay categorías cargadas</h2>
        <p className="text-sm text-muted-foreground">
          Corré <code>npm run db:seed:categories</code> primero.
        </p>
      </div>
    );
  }

  const budgetRows = await db
    .select({
      categoryId: budgets.categoryId,
      month: budgets.month,
      amountUsd: budgets.amountUsd,
    })
    .from(budgets)
    .where(and(eq(budgets.householdId, session.householdId), eq(budgets.year, year)));

  const now = new Date();
  const currentYearMonth = { year: now.getFullYear(), month: now.getMonth() + 1 };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Presupuesto {year}</h1>
        <div className="flex items-center gap-3 text-sm">
          <Link href={`/budget/${year - 1}`} className="text-muted-foreground hover:underline">
            ◀ {year - 1}
          </Link>
          <Link href={`/budget/${year + 1}`} className="text-muted-foreground hover:underline">
            {year + 1} ▶
          </Link>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Valores en USD. Solo las categorías hoja son editables — las filas padre muestran
        subtotales calculados. Meses pasados son read-only.
      </p>

      <BudgetGrid
        year={year}
        currentYearMonth={currentYearMonth}
        categories={categories}
        initialBudgets={budgetRows}
      />
    </div>
  );
}
