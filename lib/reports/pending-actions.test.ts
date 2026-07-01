import { describe, it, expect } from 'vitest';
import {
  classifyOverdue,
  mapUnmatchedTransferRow,
  type UnmatchedTransferRow,
} from './pending-actions';
import { formatAccount } from '@/lib/accounts/format';

describe('classifyOverdue', () => {
  const today = '2026-05-29';

  it('marca missed sin importar la fecha', () => {
    expect(classifyOverdue('missed', '2026-01-01', today)).toBe('missed');
    expect(classifyOverdue('missed', '2099-01-01', today)).toBe('missed');
  });

  it('marca grace cuando pending con fecha ya pasada', () => {
    expect(classifyOverdue('pending', '2026-05-28', today)).toBe('grace');
    expect(classifyOverdue('pending', '2026-04-01', today)).toBe('grace');
  });

  it('no marca pending con fecha futura', () => {
    expect(classifyOverdue('pending', '2026-05-30', today)).toBeNull();
    expect(classifyOverdue('pending', '2026-12-01', today)).toBeNull();
  });

  it('borde: pending con fecha == hoy no está vencida', () => {
    expect(classifyOverdue('pending', today, today)).toBeNull();
  });

  it('matched y cancelled nunca están vencidas', () => {
    expect(classifyOverdue('matched', '2026-01-01', today)).toBeNull();
    expect(classifyOverdue('cancelled', '2026-01-01', today)).toBeNull();
  });
});

const baseRow: UnmatchedTransferRow = {
  id: 'tx-1',
  date: '2026-06-15',
  amountOriginal: '-150000.00',
  currencyOriginal: 'ARS',
  description: 'TRANSF A CAJA DE AHORRO',
  accName: 'Sueldos',
  accType: 'bank_savings',
  accCardBrand: null,
  accOwnerTag: 'Nico',
  accCurrency: 'ARS',
  accInstitutionName: 'ICBC',
};

describe('mapUnmatchedTransferRow', () => {
  it('pasa los campos base y compone el nombre de cuenta con formatAccount', () => {
    const out = mapUnmatchedTransferRow(baseRow);
    expect(out).toMatchObject({
      id: 'tx-1',
      date: '2026-06-15',
      amountOriginal: '-150000.00',
      currencyOriginal: 'ARS',
      description: 'TRANSF A CAJA DE AHORRO',
    });
    expect(out.accountName).toBe(
      formatAccount({
        institutionName: 'ICBC',
        type: 'bank_savings',
        cardBrand: null,
        name: 'Sueldos',
        ownerTag: 'Nico',
        currency: 'ARS',
      }),
    );
    // sanity: incluye institución + rótulo
    expect(out.accountName).toContain('ICBC');
    expect(out.accountName).toContain('Sueldos');
  });

  it('cuenta no resuelta en el join (accType null) → "—"', () => {
    const out = mapUnmatchedTransferRow({
      ...baseRow,
      accType: null,
      accName: null,
      accInstitutionName: null,
      accOwnerTag: null,
      accCurrency: null,
    });
    expect(out.accountName).toBe('—');
  });

  it('aplica defaults cuando ownerTag/currency vienen null', () => {
    const out = mapUnmatchedTransferRow({
      ...baseRow,
      accOwnerTag: null,
      accCurrency: null,
    });
    // ownerTag '' → se omite del tail; currency default 'ARS' → aparece
    expect(out.accountName).toMatch(/· ARS$/);
    expect(out.accountName).not.toContain('· Nico');
  });

  it('preserva monto/moneda de la pata original (USD entrante)', () => {
    const out = mapUnmatchedTransferRow({
      ...baseRow,
      amountOriginal: '2000.00',
      currencyOriginal: 'USD',
      accCurrency: 'USD',
      accType: 'broker',
      accName: null,
    });
    expect(out.amountOriginal).toBe('2000.00');
    expect(out.currencyOriginal).toBe('USD');
  });
});
