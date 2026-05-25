import { pgTable, uuid, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { households } from './households';
import { institutions } from './institutions';
import { accountTypeEnum, currencyEnum } from './enums';

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: accountTypeEnum('type').notNull(),
    currencyDefault: currencyEnum('currency_default').notNull(),
    institutionId: uuid('institution_id').references(() => institutions.id, {
      onDelete: 'restrict',
    }),
    ownerTag: text('owner_tag').notNull(),
    archived: boolean('archived').notNull().default(false),
    expectsMonthlyImport: boolean('expects_monthly_import').notNull().default(false),
    gmailLabelId: text('gmail_label_id'),
    pdfPassword: text('pdf_password'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('accounts_household_idx').on(table.householdId)],
);
