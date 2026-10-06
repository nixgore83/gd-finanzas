import { pgTable, uuid, text, timestamp, integer, numeric } from 'drizzle-orm/pg-core';
import { households } from './households';
import { authUsers } from './auth';

export const financialGoals = pgTable('financial_goals', {
  id: uuid('id').defaultRandom().primaryKey(),
  householdId: uuid('household_id')
    .notNull()
    .unique()
    .references(() => households.id, { onDelete: 'cascade' }),
  targetAhorroMensualUsd: numeric('target_ahorro_mensual_usd', {
    precision: 18,
    scale: 2,
  }).notNull(),
  edadTargetIfNico: integer('edad_target_if_nico').notNull(),
  edadTargetIfPau: integer('edad_target_if_pau').notNull(),
  numeroRetiroUsd: numeric('numero_retiro_usd', { precision: 18, scale: 2 }).notNull(),
  numeroEducacionUsd: numeric('numero_educacion_usd', { precision: 18, scale: 2 }).notNull(),
  bufferUsd: numeric('buffer_usd', { precision: 18, scale: 2 }).notNull(),
  /** Techo de gasto mensual de la casa en ARS (sin cuotas de TC). Null = sin techo. */
  topeGastoMensualArs: numeric('tope_gasto_mensual_ars', { precision: 18, scale: 2 }),
  notas: text('notas'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  updatedBy: uuid('updated_by').references(() => authUsers.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
