import { pgTable, uuid, text, date, numeric, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { households } from './households';
import { authUsers } from './auth';
import { accounts } from './accounts';
import { currencyEnum, assetTypeEnum } from './enums';

export const netWorthSnapshots = pgTable(
  'net_worth_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    totalUsd: numeric('total_usd', { precision: 18, scale: 2 }).notNull(),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => authUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('net_worth_snapshots_household_idx').on(table.householdId),
    unique('net_worth_snapshots_household_date_uq').on(table.householdId, table.date),
  ],
);

export const accountBalances = pgTable(
  'account_balances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => netWorthSnapshots.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    balance: numeric('balance', { precision: 18, scale: 2 }).notNull(),
    currency: currencyEnum('currency').notNull(),
    balanceUsd: numeric('balance_usd', { precision: 18, scale: 2 }).notNull(),
    fxRateUsed: numeric('fx_rate_used', { precision: 18, scale: 6 }),
    fxRateSource: text('fx_rate_source'),
  },
  (table) => [
    unique('account_balances_snapshot_account_uq').on(table.snapshotId, table.accountId),
  ],
);

export const holdings = pgTable(
  'holdings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => netWorthSnapshots.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    ticker: text('ticker').notNull(),
    name: text('name').notNull(),
    assetType: assetTypeEnum('asset_type').notNull(),
    quantity: numeric('quantity', { precision: 18, scale: 6 }).notNull(),
    pricePerUnit: numeric('price_per_unit', { precision: 18, scale: 6 }).notNull(),
    currency: currencyEnum('currency').notNull(),
    totalValue: numeric('total_value', { precision: 18, scale: 2 }).notNull(),
    totalValueUsd: numeric('total_value_usd', { precision: 18, scale: 2 }).notNull(),
    fxRateUsed: numeric('fx_rate_used', { precision: 18, scale: 6 }),
    fxRateSource: text('fx_rate_source'),
  },
  (table) => [index('holdings_snapshot_idx').on(table.snapshotId)],
);
