import { pgTable, uuid, boolean, timestamp } from 'drizzle-orm/pg-core';
import { households } from './households';
import { authUsers } from './auth';

export const householdSettings = pgTable('household_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  householdId: uuid('household_id')
    .notNull()
    .unique()
    .references(() => households.id, { onDelete: 'cascade' }),
  autoMatchForecasts: boolean('auto_match_forecasts').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  updatedBy: uuid('updated_by').references(() => authUsers.id, { onDelete: 'set null' }),
});
