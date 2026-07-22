import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { currencyEnum } from './enums';

export const institutions = pgTable('institutions', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  country: text('country').notNull(),
  defaultCurrency: currencyEnum('default_currency').notNull(),
  // Contraseña del PDF del extracto (default de la institución), SIEMPRE CIFRADA
  // (AES-256-GCM, payload `v1:<iv>:<tag>:<ct>` — ver lib/crypto/secret-box.ts).
  // Se descifra en el punto de uso con `decryptPdfPassword()`.
  pdfPassword: text('pdf_password'),
  archived: boolean('archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
