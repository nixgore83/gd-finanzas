import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildBackupZip } from './build-zip';
import type { HouseholdSnapshot } from './snapshot';

const baseSnapshot: HouseholdSnapshot = {
  generatedAt: '2026-05-20T12:00:00.000Z',
  householdId: 'hh-1',
  tables: {
    households: [{ id: 'hh-1', name: 'Garaglio-Dasso' }],
    household_members: [],
    profiles: [],
    accounts: [{ id: 'acc-1', name: 'ICBC Caja' }],
    categories: [],
    tags: [],
    transactions: [],
    transaction_tags: [],
    recurrences: [],
    forecasts: [],
    budgets: [],
    imports: [],
    import_lines: [],
    financial_goals: [],
    fx_rates: [],
    institutions: [{ id: 'inst-1', name: 'ICBC' }],
  },
};

describe('buildBackupZip', () => {
  it('produce un zip con snapshot.json + tables/ + README.txt', async () => {
    const bytes = await buildBackupZip(baseSnapshot);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const re = await JSZip.loadAsync(bytes);
    const names = Object.keys(re.files).sort();
    expect(names).toContain('snapshot.json');
    expect(names).toContain('README.txt');
    expect(names).toContain('tables/households.csv');
    expect(names).toContain('tables/accounts.csv');
    expect(names).toContain('tables/institutions.csv');
    expect(names).toContain('tables/transactions.csv');
  });

  it('snapshot.json contiene shape esperado', async () => {
    const bytes = await buildBackupZip(baseSnapshot);
    const re = await JSZip.loadAsync(bytes);
    const json = JSON.parse(await re.file('snapshot.json')!.async('string'));
    expect(json.householdId).toBe('hh-1');
    expect(json.tables.accounts).toHaveLength(1);
    expect(json.tables.institutions).toHaveLength(1);
  });

  it('CSV de tabla vacía igual existe (con marker)', async () => {
    const bytes = await buildBackupZip(baseSnapshot);
    const re = await JSZip.loadAsync(bytes);
    const txCsv = await re.file('tables/transactions.csv')!.async('string');
    expect(txCsv).toContain('(sin filas)');
  });

  it('CSV con datos: usa keys como headers + BOM UTF-8', async () => {
    const bytes = await buildBackupZip(baseSnapshot);
    const re = await JSZip.loadAsync(bytes);
    const accCsv = await re.file('tables/accounts.csv')!.async('string');
    expect(accCsv.charCodeAt(0)).toBe(0xfeff);
    expect(accCsv).toContain('id,name');
    expect(accCsv).toContain('acc-1,ICBC Caja');
  });

  it('README incluye conteo de filas + fecha + householdId', async () => {
    const bytes = await buildBackupZip(baseSnapshot);
    const re = await JSZip.loadAsync(bytes);
    const readme = await re.file('README.txt')!.async('string');
    expect(readme).toContain('2026-05-20');
    expect(readme).toContain('hh-1');
    expect(readme).toContain('accounts: 1');
    expect(readme).toContain('institutions: 1');
  });
});
