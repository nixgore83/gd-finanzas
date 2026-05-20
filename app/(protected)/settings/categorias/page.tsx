import { redirect } from 'next/navigation';
import { loadCategoryTree, type CategoryNode } from '@/lib/categories/tree';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { InvestmentToggle } from './investment-toggle';

export const metadata = {
  title: 'Categorías · gd-finanzas',
};

export default async function CategoriasPage() {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const tree = await loadCategoryTree(session.householdId);
  const childrenIds = new Set(tree.filter((c) => c.parentId !== null).map((c) => c.parentId));
  // Leaf = no tiene hijos. Solo hojas reciben toggle.
  const isLeaf = (c: CategoryNode) => !childrenIds.has(c.id);

  const expenseRows = tree.filter((c) => c.kind === 'expense');

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Categorías</h1>
        <p className="text-sm text-muted-foreground">
          Marcá como &ldquo;inversión&rdquo; las categorías cuyos egresos representen ahorro
          (ej. aportes a Rabbit Hole). El Reporte D los suma de vuelta al ahorro mensual.
          Sólo se muestran gastos — los ingresos no aplican.
        </p>
      </div>

      <Section title="Gastos" rows={expenseRows} isLeaf={isLeaf} />
    </div>
  );
}

function Section({
  title,
  rows,
  isLeaf,
}: {
  title: string;
  rows: CategoryNode[];
  isLeaf: (c: CategoryNode) => boolean;
}) {
  if (rows.length === 0) {
    return (
      <section className="rounded-md border">
        <h2 className="border-b px-3 py-2 text-sm font-semibold">{title}</h2>
        <p className="px-3 py-4 text-sm text-muted-foreground">
          Sin categorías activas.
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-md border">
      <h2 className="border-b px-3 py-2 text-sm font-semibold">{title}</h2>
      <ul className="divide-y">
        {rows.map((c) => (
          <li
            key={c.id}
            className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
          >
            <span
              className={c.depth === 1 ? 'pl-4 text-muted-foreground' : 'font-medium'}
            >
              {c.name}
            </span>
            {isLeaf(c) ? (
              <InvestmentToggle categoryId={c.id} initial={c.isInvestment} />
            ) : (
              <span className="text-xs text-muted-foreground">grupo</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
