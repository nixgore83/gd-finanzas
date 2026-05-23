import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { currencyEnum } from './enums';

export const institutions = pgTable('institutions', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  country: text('country').notNull(),
  defaultCurrency: currencyEnum('default_currency').notNull(),
  pdfPassword: text('pdf_password'),
  archived: boolean('archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
