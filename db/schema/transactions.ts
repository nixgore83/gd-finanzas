import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  date,
  numeric,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { households } from './households';
import { accounts } from './accounts';
import { categories } from './categories';
import { authUsers } from './auth';
import {
  transactionKindEnum,
  transactionSubtypeEnum,
  transactionSourceEnum,
  currencyEnum,
} from './enums';

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'restrict' }),
    kind: transactionKindEnum('kind').notNull(),
    transactionSubtype: transactionSubtypeEnum('transaction_subtype')
      .notNull()
      .default('standard'),
    amountOriginal: numeric('amount_original', { precision: 18, scale: 2 }).notNull(),
    currencyOriginal: currencyEnum('currency_original').notNull(),
    amountUsd: numeric('amount_usd', { precision: 18, scale: 2 }).notNull(),
    amountArs: numeric('amount_ars', { precision: 18, scale: 2 }).notNull(),
    fxRateUsed: numeric('fx_rate_used', { precision: 18, scale: 6 }).notNull(),
    fxRateSource: text('fx_rate_source').notNull(),
    description: text('description').notNull(),
    notes: text('notes'),
    source: transactionSourceEnum('source').notNull().default('manual'),
    importBatchId: uuid('import_batch_id'),
    recurrenceId: uuid('recurrence_id'),
    transferPairId: uuid('transfer_pair_id'),
    deducibleGanancias: boolean('deducible_ganancias').notNull().default(false),
    meta: jsonb('meta').notNull().default({}),
    createdBy: uuid('created_by').references(() => authUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('transactions_household_date_idx').on(table.householdId, table.date),
    index('transactions_account_idx').on(table.accountId),
    index('transactions_category_idx').on(table.categoryId),
    index('transactions_transfer_pair_idx').on(table.transferPairId),
  ],
);
