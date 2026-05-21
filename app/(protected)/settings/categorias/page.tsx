import { redirect } from 'next/navigation';
import { loadCategoryTree, type CategoryNode } from '@/lib/categories/tree';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { Display, Label, Body, Hair } from '@/components/ui/typography';
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
  const isLeaf = (c: CategoryNode) => !childrenIds.has(c.id);

  const expenseRows = tree.filter((c) => c.kind === 'expense');
  const investCount = expenseRows.filter((c) => isLeaf(c) && c.isInvestment).length;
  const leafCount = expenseRows.filter((c) => isLeaf(c)).length;

  // Group by parent for visual separation
  const groups: Array<{ parent: CategoryNode | null; rows: CategoryNode[] }> = [];
  let current: { parent: CategoryNode | null; rows: CategoryNode[] } | null = null;
  for (const c of expenseRows) {
    if (c.parentId === null) {
      current = { parent: c, rows: [] };
      groups.push(current);
    } else if (current && c.parentId === current.parent?.id) {
      current.rows.push(c);
    } else {
      // orphan child: render as own group
      groups.push({ parent: c, rows: [] });
    }
  }

  return (
    <div className="space-y-8">
      <header className="pt-2">
        <Label>Settings · Categorías</Label>
        <Display size="lg" className="mt-2 block">
          Categorías
        </Display>
        <Body className="mt-2 max-w-2xl">
          Las marcadas como{' '}
          <span className="not-italic font-medium text-[color:var(--attn)]">inversión</span>{' '}
          suman al ahorro en el Reporte D, no al gasto.{' '}
          <span className="not-italic text-foreground">
            {investCount} de {leafCount}
          </span>{' '}
          marcadas.
        </Body>
      </header>

      <Hair thick />

      {groups.length === 0 ? (
        <div className="border border-dashed border-border p-10 text-center">
          <Body>Sin categorías de gasto cargadas.</Body>
        </div>
      ) : (
        <div className="space-y-10">
          {groups.map((group) => {
            const parent = group.parent;
            if (!parent) return null;
            const isGroupInvestment = isLeaf(parent) && parent.isInvestment;
            return (
              <section key={parent.id}>
                <div className="flex flex-wrap items-baseline gap-3 border-b border-border pb-2">
                  <span
                    className="inline-block h-4 w-[3px] bg-[color:var(--bad)]"
                    aria-hidden
                  />
                  <Display size="sm">{parent.name}</Display>
                  {isGroupInvestment && (
                    <span
                      className="inline-block rounded-full px-2 py-0.5 font-sans text-[9px] font-semibold uppercase tracking-[0.18em]"
                      style={{
                        background: 'color-mix(in oklab, var(--attn) 18%, transparent)',
                        color: 'var(--attn)',
                      }}
                    >
                      Grupo · Inversión
                    </span>
                  )}
                  <Label className="ml-auto">
                    {group.rows.length} {group.rows.length === 1 ? 'categoría' : 'categorías'}
                  </Label>
                </div>

                {/* Parent row first if it's also a leaf (no children) */}
                {isLeaf(parent) && (
                  <CategoryRow category={parent} isLeaf isParentNode />
                )}

                {group.rows.length === 0 && !isLeaf(parent) && (
                  <p className="px-2 py-4 font-display text-sm italic text-muted-foreground">
                    Sin sub-categorías.
                  </p>
                )}

                {group.rows.map((child) => (
                  <CategoryRow key={child.id} category={child} isLeaf={isLeaf(child)} />
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CategoryRow({
  category,
  isLeaf,
  isParentNode = false,
}: {
  category: CategoryNode;
  isLeaf: boolean;
  isParentNode?: boolean;
}) {
  return (
    <div
      className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border/40 py-3 transition-colors hover:bg-primary/[0.03]"
      style={{ paddingLeft: isParentNode ? 0 : 20 }}
    >
      <div className="flex items-center gap-3">
        <span className="font-display text-base text-foreground">{category.name}</span>
        {category.isInvestment && (
          <span
            className="font-sans text-[9px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: 'var(--attn)' }}
          >
            · inversión
          </span>
        )}
      </div>
      {isLeaf ? (
        <InvestmentToggle categoryId={category.id} initial={category.isInvestment} />
      ) : (
        <Label>Grupo</Label>
      )}
    </div>
  );
}
