import { pgTable, uuid, timestamp, date, numeric, index } from 'drizzle-orm/pg-core';
import { recurrences } from './recurrences';
import { transactions } from './transactions';
import { currencyEnum, forecastStatusEnum } from './enums';

export const forecasts = pgTable(
  'forecasts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recurrenceId: uuid('recurrence_id')
      .notNull()
      .references(() => recurrences.id, { onDelete: 'cascade' }),
    expectedDate: date('expected_date').notNull(),
    expectedAmount: numeric('expected_amount', { precision: 18, scale: 2 }).notNull(),
    currency: currencyEnum('currency').notNull(),
    status: forecastStatusEnum('status').notNull().default('pending'),
    matchedTransactionId: uuid('matched_transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('forecasts_recurrence_date_idx').on(table.recurrenceId, table.expectedDate),
    index('forecasts_status_idx').on(table.status),
  ],
);
