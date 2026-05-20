/**
 * Tipos compartidos para los builders de export contador. Todos son puros —
 * el loader (`ganancias-data.ts`) los arma desde la DB y los pasa a los
 * builders.
 */

export type ExportAccount = {
  id: string;
  name: string;
  type:
    | 'bank_checking'
    | 'bank_savings'
    | 'credit_card'
    | 'cash'
    | 'broker'
    | 'ewallet'
    | 'other';
};

export type ExportCategory = {
  id: string;
  name: string;
};

export type ExportTx = {
  id: string;
  date: string; // YYYY-MM-DD
  accountId: string;
  categoryId: string | null;
  kind: 'income' | 'expense' | 'transfer';
  transactionSubtype: 'standard' | 'domestic_service';
  amountOriginal: string;
  currencyOriginal: 'ARS' | 'USD';
  amountUsd: string;
  amountArs: string;
  description: string;
  notes: string | null;
  deducibleGanancias: boolean;
  meta: Record<string, unknown>;
};

export function monthOf(date: string): string {
  return date.slice(0, 7); // YYYY-MM
}

export function yearOf(date: string): string {
  return date.slice(0, 4); // YYYY
}
