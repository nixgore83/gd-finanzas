import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { financialGoals, profiles } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { FINANCIAL_GOALS_DEFAULTS } from '@/lib/financial-goals/defaults';
import { Display, Label, Body, Hair } from '@/components/ui/typography';
import { FinancialGoalsForm } from './financial-goals-form';

export const metadata = {
  title: 'Metas · gd-finanzas',
};

export default async function MetasPage() {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const db = getDb();
  const [existing] = await db
    .select({
      targetAhorroMensualUsd: financialGoals.targetAhorroMensualUsd,
      edadTargetIfNico: financialGoals.edadTargetIfNico,
      edadTargetIfPau: financialGoals.edadTargetIfPau,
      numeroRetiroUsd: financialGoals.numeroRetiroUsd,
      numeroEducacionUsd: financialGoals.numeroEducacionUsd,
      bufferUsd: financialGoals.bufferUsd,
      notas: financialGoals.notas,
      updatedAt: financialGoals.updatedAt,
      updatedBy: financialGoals.updatedBy,
    })
    .from(financialGoals)
    .where(eq(financialGoals.householdId, session.householdId))
    .limit(1);

  let updatedByEmail: string | null = null;
  if (existing?.updatedBy) {
    const [u] = await db
      .select({ name: profiles.displayName })
      .from(profiles)
      .where(eq(profiles.id, existing.updatedBy))
      .limit(1);
    updatedByEmail = u?.name ?? null;
  }

  const initial = existing
    ? {
        targetAhorroMensualUsd: existing.targetAhorroMensualUsd,
        edadTargetIfNico: existing.edadTargetIfNico,
        edadTargetIfPau: existing.edadTargetIfPau,
        numeroRetiroUsd: existing.numeroRetiroUsd,
        numeroEducacionUsd: existing.numeroEducacionUsd,
        bufferUsd: existing.bufferUsd,
        notas: existing.notas,
        updatedAt: existing.updatedAt?.toISOString() ?? null,
        updatedByEmail,
      }
    : {
        targetAhorroMensualUsd: FINANCIAL_GOALS_DEFAULTS.targetAhorroMensualUsd,
        edadTargetIfNico: FINANCIAL_GOALS_DEFAULTS.edadTargetIfNico,
        edadTargetIfPau: FINANCIAL_GOALS_DEFAULTS.edadTargetIfPau,
        numeroRetiroUsd: FINANCIAL_GOALS_DEFAULTS.numeroRetiroUsd,
        numeroEducacionUsd: FINANCIAL_GOALS_DEFAULTS.numeroEducacionUsd,
        bufferUsd: FINANCIAL_GOALS_DEFAULTS.bufferUsd,
        notas: FINANCIAL_GOALS_DEFAULTS.notas,
        updatedAt: null,
        updatedByEmail: null,
      };

  return (
    <div className="space-y-8">
      <header className="pt-2">
        <Label>Settings · Metas IF</Label>
        <Display size="lg" className="mt-2 block">
          Metas financieras
        </Display>
        <Body className="mt-2 max-w-2xl">
          Los números que validamos con Pau el 5 de mayo 2026. Editables — alimentan
          el bloque <em className="not-italic text-foreground">Trayectoria a IF</em> del Reporte D.
        </Body>
      </header>

      <Hair thick />

      <FinancialGoalsForm initial={initial} />
    </div>
  );
}
