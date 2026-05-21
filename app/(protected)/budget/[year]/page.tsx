import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { budgets } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadCategoryTree } from '@/lib/categories/tree';
import { Display, Label, Body, Hair } from '@/components/ui/typography';
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
      <div className="mx-auto max-w-xl space-y-4 border border-dashed border-border p-10 text-center">
        <Display size="md">Sin categorías cargadas</Display>
        <Body>
          Corré <code className="font-mono not-italic text-foreground">npm run db:seed:categories</code> primero.
        </Body>
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
    <div className="space-y-8">
      {/* ============ HEADER ============ */}
      <header className="flex flex-wrap items-end justify-between gap-6 pt-2">
        <div className="min-w-0">
          <Label>Planificar · Presupuesto</Label>
          <div className="mt-2 flex items-baseline gap-4">
            <Display size="lg">Presupuesto</Display>
            <Display size="lg" className="tabular-nums text-primary">
              {year}
            </Display>
          </div>
          <Body className="mt-1 max-w-2xl">
            Cifras en USD. Solo las hojas son editables — los padres muestran subtotales
            calculados. Meses pasados son read-only.
          </Body>
        </div>

        {/* Year navigation */}
        <nav className="flex items-baseline gap-5 font-display">
          <Link
            href={`/budget/${year - 1}`}
            className="text-base italic text-muted-foreground transition-colors hover:text-primary"
          >
            ◀ {year - 1}
          </Link>
          <span className="text-2xl font-light tabular-nums text-foreground">{year}</span>
          <Link
            href={`/budget/${year + 1}`}
            className="text-base italic text-muted-foreground transition-colors hover:text-primary"
          >
            {year + 1} ▶
          </Link>
        </nav>
      </header>

      <Hair thick />

      <BudgetGrid
        year={year}
        currentYearMonth={currentYearMonth}
        categories={categories}
        initialBudgets={budgetRows}
      />
    </div>
  );
}
