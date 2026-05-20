import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { households } from './households';
import { institutions } from './institutions';
import { authUsers } from './auth';
import { categories } from './categories';
import { transactions } from './transactions';
import { importTypeEnum, importStatusEnum, importLineStatusEnum } from './enums';

export const imports = pgTable(
  'imports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    fileUrl: text('file_url').notNull(),
    fileHash: text('file_hash').notNull().default(''),
    type: importTypeEnum('type').notNull(),
    institutionId: uuid('institution_id').references(() => institutions.id, {
      onDelete: 'restrict',
    }),
    parserModel: text('parser_model').notNull(),
    status: importStatusEnum('status').notNull().default('uploaded'),
    errorMessage: text('error_message'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    transactionCount: integer('transaction_count'),
    createdBy: uuid('created_by').references(() => authUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('imports_household_idx').on(table.householdId),
    index('imports_household_hash_idx').on(table.householdId, table.fileHash),
  ],
);

export const importLines = pgTable(
  'import_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    importId: uuid('import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    rawData: jsonb('raw_data').notNull(),
    parsedData: jsonb('parsed_data').notNull(),
    proposedCategoryId: uuid('proposed_category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    status: importLineStatusEnum('status').notNull().default('pending'),
    transactionId: uuid('transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('import_lines_import_idx').on(table.importId)],
);
