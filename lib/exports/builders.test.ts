import { describe, it, expect } from 'vitest';
import { buildIngresosCsv } from './ingresos';
import { buildConsumosTcCsv } from './consumos-tc';
import { buildServicioDomesticoCsv } from './servicio-domestico';
import { buildGastosDeduciblesCsv } from './gastos-deducibles';
import { buildOtrosIngresosCsv } from './otros-ingresos';
import type { ExportAccount, ExportCategory, ExportTx } from './types';

const accounts: ExportAccount[] = [
  { id: 'acc-galicia-amex', name: 'Galicia Amex', type: 'credit_card' },
  { id: 'acc-icbc-caja', name: 'ICBC Caja ARS', type: 'bank_savings' },
];
const accountsById = new Map(accounts.map((a) => [a.id, a]));

const categories: ExportCategory[] = [
  { id: 'cat-sueldo-nico', name: 'Sueldo Nico' },
  { id: 'cat-alquileres', name: 'Alquileres' },
  { id: 'cat-gastos-varios', name: 'Gastos varios' },
];
const categoriesById = new Map(categories.map((c) => [c.id, c]));

function tx(overrides: Partial<ExportTx> = {}): ExportTx {
  return {
    id: overrides.id ?? `tx-${Math.random().toString(36).slice(2)}`,
    date: '2026-05-15',
    accountId: 'acc-icbc-caja',
    categoryId: null,
    kind: 'expense',
    transactionSubtype: 'standard',
    amountOriginal: '100.00',
    currencyOriginal: 'ARS',
    amountUsd: '0.10',
    amountArs: '100.00',
    description: 'X',
    notes: null,
    deducibleGanancias: false,
    meta: {},
    ...overrides,
  };
}

describe('buildIngresosCsv', () => {
  it('filtra solo income', () => {
    const out = buildIngresosCsv(
      [
        tx({ kind: 'expense', description: 'gasto' }),
        tx({
          kind: 'income',
          description: 'Sueldo Mayo',
          categoryId: 'cat-sueldo-nico',
          amountOriginal: '500000.00',
        }),
      ],
      accountsById,
      categoriesById,
    );
    expect(out).toContain('Sueldo Mayo');
    expect(out).not.toContain('gasto');
  });

  it('ordena por fecha asc', () => {
    const out = buildIngresosCsv(
      [
        tx({ kind: 'income', date: '2026-05-20', description: 'tx-B' }),
        tx({ kind: 'income', date: '2026-05-10', description: 'tx-A' }),
      ],
      accountsById,
      categoriesById,
    );
    expect(out.indexOf('tx-A')).toBeLessThan(out.indexOf('tx-B'));
  });

  it('include columnas multi-moneda', () => {
    const out = buildIngresosCsv(
      [tx({ kind: 'income', amountOriginal: '100', currencyOriginal: 'USD', amountUsd: '100', amountArs: '125000' })],
      accountsById,
      categoriesById,
    );
    expect(out).toContain('100,USD,100,125000');
  });
});

describe('buildConsumosTcCsv', () => {
  it('solo cuentas credit_card', () => {
    const out = buildConsumosTcCsv(
      [
        tx({ kind: 'expense', accountId: 'acc-galicia-amex', amountOriginal: '500' }),
        tx({ kind: 'expense', accountId: 'acc-icbc-caja', amountOriginal: '700' }),
      ],
      accountsById,
    );
    expect(out).toContain('Galicia Amex');
    expect(out).not.toContain('ICBC Caja');
  });

  it('agrupa por mes + moneda con suma y count', () => {
    const out = buildConsumosTcCsv(
      [
        tx({ kind: 'expense', accountId: 'acc-galicia-amex', date: '2026-05-10', amountOriginal: '100', amountUsd: '0.10', amountArs: '100' }),
        tx({ kind: 'expense', accountId: 'acc-galicia-amex', date: '2026-05-20', amountOriginal: '200', amountUsd: '0.20', amountArs: '200' }),
        tx({ kind: 'expense', accountId: 'acc-galicia-amex', date: '2026-06-01', amountOriginal: '50', amountUsd: '0.05', amountArs: '50' }),
      ],
      accountsById,
    );
    // Mayo: 2 consumos, total 300
    expect(out).toContain('2026-05,ARS,2,300.00');
    expect(out).toContain('2026-06,ARS,1,50.00');
  });
});

describe('buildServicioDomesticoCsv', () => {
  it('filtra subtype domestic_service y expande meta', () => {
    const out = buildServicioDomesticoCsv([
      tx({
        kind: 'expense',
        transactionSubtype: 'domestic_service',
        amountOriginal: '120000',
        meta: {
          empleado_nombre: 'Rougier Nahir',
          empleado_cuil: '27-41996999-6',
          concepto: 'sueldo',
          periodo: '2026-05',
        },
      }),
      tx({ kind: 'expense', description: 'compra' }),
    ]);
    expect(out).toContain('Rougier Nahir');
    expect(out).toContain('27-41996999-6');
    expect(out).toContain('sueldo');
    expect(out).toContain('2026-05');
    expect(out).not.toContain('compra');
  });

  it('saltea filas con meta inválida', () => {
    const out = buildServicioDomesticoCsv([
      tx({
        kind: 'expense',
        transactionSubtype: 'domestic_service',
        meta: { empleado_nombre: 'X', empleado_cuil: 'mal-cuil', concepto: 'sueldo', periodo: '2026-05' },
      }),
    ]);
    const lines = out.replace(/^﻿/, '').split('\r\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(1); // solo header
  });
});

describe('buildGastosDeduciblesCsv', () => {
  it('solo deducible=true', () => {
    const out = buildGastosDeduciblesCsv(
      [
        tx({ kind: 'expense', description: 'A', deducibleGanancias: true }),
        tx({ kind: 'expense', description: 'B', deducibleGanancias: false }),
      ],
      accountsById,
      categoriesById,
    );
    expect(out).toContain(',A,');
    expect(out).not.toContain(',B,');
  });
});

describe('buildOtrosIngresosCsv', () => {
  it('filtra income con categoria que NO contiene "sueldo"', () => {
    const out = buildOtrosIngresosCsv(
      [
        tx({ kind: 'income', categoryId: 'cat-sueldo-nico', description: 'sueldo' }),
        tx({ kind: 'income', categoryId: 'cat-alquileres', description: 'alquiler' }),
      ],
      accountsById,
      categoriesById,
    );
    expect(out).toContain('alquiler');
    expect(out).not.toContain(',sueldo,');
  });

  it('income sin categoría se incluye', () => {
    const out = buildOtrosIngresosCsv(
      [tx({ kind: 'income', categoryId: null, description: 'huerfano' })],
      accountsById,
      categoriesById,
    );
    expect(out).toContain('huerfano');
  });
});
