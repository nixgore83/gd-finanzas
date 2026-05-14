import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  date,
  numeric,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { households } from './households';
import { accounts } from './accounts';
import { categories } from './categories';
import { categoryKindEnum, currencyEnum, recurrenceFrequencyEnum } from './enums';

export const recurrences = pgTable(
  'recurrences',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'restrict' }),
    kind: categoryKindEnum('kind').notNull(),
    amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
    currency: currencyEnum('currency').notNull(),
    frequency: recurrenceFrequencyEnum('frequency').notNull(),
    dayOfMonth: integer('day_of_month'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('recurrences_household_idx').on(table.householdId)],
);
