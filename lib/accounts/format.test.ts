import { describe, it, expect } from 'vitest';
import { formatAccount, type AccountForDisplay } from './format';

const base: AccountForDisplay = {
  institutionName: 'Galicia',
  type: 'credit_card',
  cardBrand: 'visa',
  name: '',
  ownerTag: 'Nico',
  currency: 'ARS',
};

describe('formatAccount — producto por tipo', () => {
  it('TC usa la marca (card_brand)', () => {
    expect(formatAccount({ ...base, type: 'credit_card', cardBrand: 'amex' })).toBe(
      'Galicia Amex · Nico · ARS',
    );
    expect(formatAccount({ ...base, type: 'credit_card', cardBrand: 'master' })).toBe(
      'Galicia Master · Nico · ARS',
    );
  });

  it('caja de ahorro y cuenta corriente salen del tipo', () => {
    expect(
      formatAccount({ ...base, type: 'bank_savings', cardBrand: null, currency: 'USD' }),
    ).toBe('Galicia Caja de ahorro · Nico · USD');
    expect(
      formatAccount({
        ...base,
        institutionName: 'ICBC',
        type: 'bank_checking',
        cardBrand: null,
      }),
    ).toBe('ICBC Cuenta corriente · Nico · ARS');
  });

  it('broker muestra "Inversiones" para no confundirse con CA/CC', () => {
    expect(
      formatAccount({ ...base, institutionName: 'Cocos', type: 'broker', cardBrand: null }),
    ).toBe('Cocos Inversiones · Nico · ARS');
  });

  it('ewallet no muestra producto', () => {
    expect(
      formatAccount({
        ...base,
        institutionName: 'Mercado Pago',
        type: 'ewallet',
        cardBrand: null,
      }),
    ).toBe('Mercado Pago · Nico · ARS');
  });

  it('cash se muestra como "Efectivo" sin institución', () => {
    expect(
      formatAccount({
        institutionName: null,
        type: 'cash',
        cardBrand: null,
        name: '',
        ownerTag: 'Hogar',
        currency: 'USD',
      }),
    ).toBe('Efectivo · Hogar · USD');
  });
});

describe('formatAccount — rótulo', () => {
  it('agrega el rótulo cuando tiene contenido', () => {
    expect(
      formatAccount({
        institutionName: 'Balanz',
        type: 'broker',
        cardBrand: null,
        name: 'Argentina',
        ownerTag: 'Hogar',
        currency: 'USD',
      }),
    ).toBe('Balanz Inversiones Argentina · Hogar · USD');
  });

  it('ignora rótulo vacío o de solo espacios', () => {
    expect(formatAccount({ ...base, name: '   ' })).toBe('Galicia Visa · Nico · ARS');
  });
});

describe('formatAccount — opciones de sufijo', () => {
  it('puede omitir dueño y/o moneda', () => {
    expect(formatAccount(base, { withOwner: false })).toBe('Galicia Visa · ARS');
    expect(formatAccount(base, { withCurrency: false })).toBe('Galicia Visa · Nico');
    expect(formatAccount(base, { withOwner: false, withCurrency: false })).toBe('Galicia Visa');
  });
});

describe('formatAccount — las 28 cuentas reales son todas distintas', () => {
  const accounts: AccountForDisplay[] = [
    { institutionName: 'Galicia', type: 'credit_card', cardBrand: 'amex', name: '', ownerTag: 'Nico', currency: 'ARS' },
    { institutionName: 'Galicia', type: 'credit_card', cardBrand: 'visa', name: '', ownerTag: 'Nico', currency: 'ARS' },
    { institutionName: 'Galicia', type: 'credit_card', cardBrand: 'visa', name: '', ownerTag: 'Pau', currency: 'ARS' },
    { institutionName: 'Galicia', type: 'credit_card', cardBrand: 'master', name: '', ownerTag: 'Nico', currency: 'ARS' },
    { institutionName: 'Galicia', type: 'credit_card', cardBrand: 'master', name: '', ownerTag: 'Pau', currency: 'ARS' },
    { institutionName: 'Galicia', type: 'bank_savings', cardBrand: null, name: '', ownerTag: 'Nico', currency: 'USD' },
    { institutionName: 'Galicia', type: 'bank_savings', cardBrand: null, name: '', ownerTag: 'Nico', currency: 'ARS' },
    { institutionName: 'Galicia', type: 'bank_savings', cardBrand: null, name: '', ownerTag: 'Pau', currency: 'ARS' },
    { institutionName: 'Galicia', type: 'broker', cardBrand: null, name: '', ownerTag: 'Nico', currency: 'ARS' },
    { institutionName: 'Galicia', type: 'broker', cardBrand: null, name: '', ownerTag: 'Pau', currency: 'ARS' },
    { institutionName: 'ICBC', type: 'credit_card', cardBrand: 'visa', name: '', ownerTag: 'Nico', currency: 'ARS' },
    { institutionName: 'ICBC', type: 'credit_card', cardBrand: 'master', name: '', ownerTag: 'Nico', currency: 'ARS' },
    { institutionName: 'ICBC', type: 'bank_savings', cardBrand: null, name: '', ownerTag: 'Nico', currency: 'USD' },
    { institutionName: 'ICBC', type: 'bank_savings', cardBrand: null, name: '', ownerTag: 'Nico', currency: 'ARS' },
    { institutionName: 'ICBC', type: 'bank_checking', cardBrand: null, name: '', ownerTag: 'Nico', currency: 'ARS' },
    { institutionName: 'ICBC', type: 'broker', cardBrand: null, name: '', ownerTag: 'Nico', currency: 'ARS' },
    { institutionName: 'Balanz', type: 'broker', cardBrand: null, name: '', ownerTag: 'Nico', currency: 'ARS' },
    { institutionName: 'Balanz', type: 'broker', cardBrand: null, name: 'Argentina', ownerTag: 'Hogar', currency: 'USD' },
    { institutionName: 'Balanz', type: 'broker', cardBrand: null, name: 'Internacional', ownerTag: 'Hogar', currency: 'USD' },
    { institutionName: 'Cocos', type: 'broker', cardBrand: null, name: '', ownerTag: 'Nico', currency: 'ARS' },
    { institutionName: 'Cocos', type: 'broker', cardBrand: null, name: '', ownerTag: 'Hogar', currency: 'USD' },
    { institutionName: 'BNA', type: 'credit_card', cardBrand: 'visa', name: '', ownerTag: 'Nico', currency: 'ARS' },
    { institutionName: 'HSBC US', type: 'bank_checking', cardBrand: null, name: '', ownerTag: 'Nico', currency: 'USD' },
    { institutionName: 'HSBC US', type: 'credit_card', cardBrand: 'master', name: '', ownerTag: 'Nico', currency: 'USD' },
    { institutionName: 'Mercado Pago', type: 'credit_card', cardBrand: 'master', name: '', ownerTag: 'Nico', currency: 'ARS' },
    { institutionName: 'Mercado Pago', type: 'ewallet', cardBrand: null, name: '', ownerTag: 'Nico', currency: 'ARS' },
    { institutionName: null, type: 'cash', cardBrand: null, name: '', ownerTag: 'Hogar', currency: 'ARS' },
    { institutionName: null, type: 'cash', cardBrand: null, name: '', ownerTag: 'Hogar', currency: 'USD' },
  ];

  it('no hay dos displays iguales', () => {
    const displays = accounts.map((a) => formatAccount(a));
    expect(new Set(displays).size).toBe(accounts.length);
  });

  it('muestras concretas del mapeo acordado', () => {
    expect(formatAccount(accounts[17]!)).toBe('Balanz Inversiones Argentina · Hogar · USD');
    expect(formatAccount(accounts[23]!)).toBe('HSBC US Master · Nico · USD');
    expect(formatAccount(accounts[24]!)).toBe('Mercado Pago Master · Nico · ARS');
    expect(formatAccount(accounts[25]!)).toBe('Mercado Pago · Nico · ARS');
  });
});
