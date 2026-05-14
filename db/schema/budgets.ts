import { pgTable, uuid, timestamp, integer, numeric, uniqueIndex } from 'drizzle-orm/pg-core';
import { households } from './households';
import { categories } from './categories';

export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    month: integer('month').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    amountUsd: numeric('amount_usd', { precision: 18, scale: 2 }).notNull(),
    revisionAt: timestamp('revision_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('budgets_household_year_month_category_idx').on(
      table.householdId,
      table.year,
      table.month,
      table.categoryId,
    ),
  ],
);
