import { pgTable, uuid, text, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { households } from './households';
import { accounts } from './accounts';
import { authUsers } from './auth';

/**
 * Meses que el usuario marcó explícitamente como "sin movimientos" para una cuenta.
 * El detector de gaps (`detectImportGaps`) los excluye de los "resúmenes faltantes":
 * permite distinguir "no importaste" de "no hubo movimientos ese mes" en cuentas
 * con actividad esporádica (ej. una cuenta corriente que algunos meses no se mueve).
 */
export const accountSkippedMonths = pgTable(
  'account_skipped_months',
  {
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    yearMonth: text('year_month').notNull(), // 'YYYY-MM'
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid('created_by').references(() => authUsers.id, { onDelete: 'set null' }),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.yearMonth] }),
    index('account_skipped_months_household_idx').on(table.householdId),
  ],
);
