import { pgTable, text, timestamp, date, numeric, primaryKey } from 'drizzle-orm/pg-core';

export const fxRates = pgTable(
  'fx_rates',
  {
    date: date('date').notNull(),
    currencyPair: text('currency_pair').notNull(),
    source: text('source').notNull(),
    buy: numeric('buy', { precision: 18, scale: 6 }),
    sell: numeric('sell', { precision: 18, scale: 6 }),
    mid: numeric('mid', { precision: 18, scale: 6 }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.date, table.currencyPair] })],
);
