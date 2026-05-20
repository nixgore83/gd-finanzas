import { eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  accounts,
  budgets,
  categories,
  financialGoals,
  forecasts,
  fxRates,
  householdMembers,
  households,
  importLines,
  imports,
  institutions,
  profiles,
  recurrences,
  tags,
  transactionTags,
  transactions,
} from '@/db/schema';

/**
 * Snapshot completo de la DB scopeado a un household. Tablas globales
 * (fx_rates, institutions) van enteras porque sin ellas el backup queda
 * incompleto (las recurrencias y txns referencian instituciones, y las
 * conversiones de moneda dependen de fx_rates).
 *
 * No incluye `auth.users` (no es nuestra tabla; Supabase la maneja aparte).
 */

export type HouseholdSnapshot = {
  generatedAt: string;
  householdId: string;
  tables: {
    households: unknown[];
    household_members: unknown[];
    profiles: unknown[];
    accounts: unknown[];
    categories: unknown[];
    tags: unknown[];
    transactions: unknown[];
    transaction_tags: unknown[];
    recurrences: unknown[];
    forecasts: unknown[];
    budgets: unknown[];
    imports: unknown[];
    import_lines: unknown[];
    financial_goals: unknown[];
    fx_rates: unknown[];
    institutions: unknown[];
  };
};

export async function loadHouseholdSnapshot(householdId: string): Promise<HouseholdSnapshot> {
  const db = getDb();

  const [
    householdsRows,
    householdMembersRows,
    profilesRows,
    accountsRows,
    categoriesRows,
    tagsRows,
    transactionsRows,
    recurrencesRows,
    budgetsRows,
    importsRows,
    financialGoalsRows,
    fxRatesRows,
    institutionsRows,
  ] = await Promise.all([
    db.select().from(households).where(eq(households.id, householdId)),
    db.select().from(householdMembers).where(eq(householdMembers.householdId, householdId)),
    db
      .select()
      .from(profiles)
      .where(
        inArray(
          profiles.id,
          db
            .select({ userId: householdMembers.userId })
            .from(householdMembers)
            .where(eq(householdMembers.householdId, householdId)),
        ),
      ),
    db.select().from(accounts).where(eq(accounts.householdId, householdId)),
    db.select().from(categories).where(eq(categories.householdId, householdId)),
    db.select().from(tags).where(eq(tags.householdId, householdId)),
    db.select().from(transactions).where(eq(transactions.householdId, householdId)),
    db.select().from(recurrences).where(eq(recurrences.householdId, householdId)),
    db.select().from(budgets).where(eq(budgets.householdId, householdId)),
    db.select().from(imports).where(eq(imports.householdId, householdId)),
    db.select().from(financialGoals).where(eq(financialGoals.householdId, householdId)),
    db.select().from(fxRates),
    db.select().from(institutions),
  ]);

  // transaction_tags y import_lines + forecasts dependen de subselects.
  const txIds = transactionsRows.map((t) => t.id);
  const transactionTagsRows =
    txIds.length === 0
      ? []
      : await db
          .select()
          .from(transactionTags)
          .where(inArray(transactionTags.transactionId, txIds));

  const importIds = importsRows.map((i) => i.id);
  const importLinesRows =
    importIds.length === 0
      ? []
      : await db.select().from(importLines).where(inArray(importLines.importId, importIds));

  const recurrenceIds = recurrencesRows.map((r) => r.id);
  const forecastsRows =
    recurrenceIds.length === 0
      ? []
      : await db.select().from(forecasts).where(inArray(forecasts.recurrenceId, recurrenceIds));

  return {
    generatedAt: new Date().toISOString(),
    householdId,
    tables: {
      households: householdsRows,
      household_members: householdMembersRows,
      profiles: profilesRows,
      accounts: accountsRows,
      categories: categoriesRows,
      tags: tagsRows,
      transactions: transactionsRows,
      transaction_tags: transactionTagsRows,
      recurrences: recurrencesRows,
      forecasts: forecastsRows,
      budgets: budgetsRows,
      imports: importsRows,
      import_lines: importLinesRows,
      financial_goals: financialGoalsRows,
      fx_rates: fxRatesRows,
      institutions: institutionsRows,
    },
  };
}
