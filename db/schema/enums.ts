import { pgEnum } from 'drizzle-orm/pg-core';

export const currencyEnum = pgEnum('currency', ['ARS', 'USD']);

export const accountTypeEnum = pgEnum('account_type', [
  'bank_checking',
  'bank_savings',
  'credit_card',
  'cash',
  'broker',
  'ewallet',
  'other',
]);

export const cardBrandEnum = pgEnum('card_brand', ['visa', 'master', 'amex']);

export const categoryKindEnum = pgEnum('category_kind', ['income', 'expense']);

export const transactionKindEnum = pgEnum('transaction_kind', ['income', 'expense', 'transfer']);

export const transactionSubtypeEnum = pgEnum('transaction_subtype', [
  'standard',
  'domestic_service',
]);

export const transactionSourceEnum = pgEnum('transaction_source', [
  'manual',
  'import',
  'recurring_match',
]);

export const recurrenceFrequencyEnum = pgEnum('recurrence_frequency', [
  'monthly',
  'bimonthly',
  'quarterly',
  'yearly',
  'custom',
]);

export const forecastStatusEnum = pgEnum('forecast_status', [
  'pending',
  'matched',
  'cancelled',
  'missed',
]);

export const importTypeEnum = pgEnum('import_type', ['tc', 'banco', 'broker']);

export const importStatusEnum = pgEnum('import_status', [
  'uploaded',
  'parsing',
  'parsed',
  'reviewing',
  'confirmed',
  'error',
]);

export const importLineStatusEnum = pgEnum('import_line_status', [
  'pending',
  'accepted',
  'rejected',
  'edited',
]);

export const assetTypeEnum = pgEnum('asset_type', [
  'stock',
  'etf',
  'bond',
  'cedear',
  'fci',
  'crypto',
  'other',
]);
