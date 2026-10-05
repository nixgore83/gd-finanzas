import { describe, it, expect } from 'vitest';
import {
  counterpartyHasStrongId,
  counterpartyIsHousehold,
  cuotaDateAtClose,
  decideLine,
  type LineInput,
  type ReviewAccount,
  type ReviewContext,
} from './bulk-review';
import type { ParsedTxLine } from './parsers/types';

const CAT_INTERESES = '11111111-1111-4111-8111-111111111111';
const CAT_PROMOS = '22222222-2222-4222-8222-222222222222';
const CAT_X = '33333333-3333-4333-8333-333333333333';
const CAT_HIST = '44444444-4444-4444-8444-444444444444';

const acct = (over: Partial<ReviewAccount> & { id: string }): ReviewAccount => ({
  institutionName: 'Galicia',
  type: 'bank_savings',
  cardBrand: null,
  currency: 'ARS',
  ownerTag: 'Nico',
  transferRefs: null,
  ...over,
});

const GALICIA_ARS_NICO = acct({ id: 'a-galicia-ars-nico', transferRefs: ['20111111112', 'cbu-nico-ars'] });
const GALICIA_BROKER_NICO = acct({ id: 'a-galicia-broker-nico', type: 'broker' });
const GALICIA_VISA_NICO = acct({ id: 'a-galicia-visa-nico', type: 'credit_card', cardBrand: 'visa' });
const GALICIA_ARS_PAU = acct({ id: 'a-galicia-ars-pau', ownerTag: 'Pau', transferRefs: ['27111111113'] });
const GALICIA_VISA_PAU_1 = acct({ id: 'a-galicia-visa-pau-1', type: 'credit_card', cardBrand: 'visa', ownerTag: 'Pau' });
const GALICIA_VISA_PAU_2 = acct({ id: 'a-galicia-visa-pau-2', type: 'credit_card', cardBrand: 'visa', ownerTag: 'Pau' });
const BIND_ARS_PAU = acct({ id: 'a-bind-ars-pau', institutionName: 'Banco Industrial', ownerTag: 'Pau' });
const BIND_USD_PAU = acct({ id: 'a-bind-usd-pau', institutionName: 'Banco Industrial', ownerTag: 'Pau', currency: 'USD' });

const ACCOUNTS = [
  GALICIA_ARS_NICO,
  GALICIA_BROKER_NICO,
  GALICIA_VISA_NICO,
  GALICIA_ARS_PAU,
  GALICIA_VISA_PAU_1,
  GALICIA_VISA_PAU_2,
  BIND_ARS_PAU,
  BIND_USD_PAU,
];

function ctx(account: ReviewAccount, periodEnd: string | null = '2026-09-24'): ReviewContext {
  return {
    account,
    accounts: ACCOUNTS,
    householdCuits: ['20111111112', '27111111113'],
    categoryIdByName: new Map([
      ['intereses', CAT_INTERESES],
      ['promos bancarias', CAT_PROMOS],
    ]),
    periodEnd,
  };
}

function parsed(over: Partial<ParsedTxLine> = {}): ParsedTxLine {
  return {
    date: '2026-09-10',
    description: 'MOVIMIENTO',
    amountOriginal: '100.00',
    currencyOriginal: 'ARS',
    kind: 'expense',
    isTransfer: false,
    isRefund: false,
    ...over,
  } as ParsedTxLine;
}

function line(over: Omit<Partial<LineInput>, 'parsed'> & { parsed?: Partial<ParsedTxLine> } = {}): LineInput {
  const { parsed: p, ...rest } = over;
  return {
    id: 'l1',
    parsed: parsed(p),
    proposedCategoryId: null,
    historyCategoryId: null,
    isDuplicate: false,
    ...rest,
  };
}

describe('decideLine — tarjetas', () => {
  it('acepta un consumo con categoría y deja pendiente uno sin categoría', () => {
    const c = ctx(GALICIA_VISA_NICO);
    expect(decideLine(c, line({ proposedCategoryId: CAT_X })).action).toBe('accept');
    expect(decideLine(c, line())).toMatchObject({ action: 'pending', reason: 'sin categoría' });
  });

  it('fecha al cierre una cuota que vino fechada al consumo original', () => {
    // Regla de negocio: en imports, cada cuota va al cierre del resumen, no a la
    // fecha de la compra. El resumen de sep de la Visa Más vino con "03/06" del 25/03.
    const c = ctx(GALICIA_VISA_PAU_2, '2026-09-24');
    const d = decideLine(
      c,
      line({ proposedCategoryId: CAT_X, parsed: { date: '2026-03-25', description: 'MERPAGO*X 03/06' } }),
    );
    expect(d).toMatchObject({ action: 'edit', reason: 'cuota fechada al cierre' });
    if (d.action === 'edit') expect(d.parsed.date).toBe('2026-09-24');
  });

  it('NO toca la fecha de una cuota ya fechada dentro del período', () => {
    const c = ctx(GALICIA_VISA_PAU_2, '2026-09-24');
    const d = decideLine(
      c,
      line({ proposedCategoryId: CAT_X, parsed: { date: '2026-09-24', description: 'MERPAGO*X 03/06' } }),
    );
    expect(d.action).toBe('accept');
  });
});

describe('cuotaDateAtClose', () => {
  it('solo mueve cuotas de tarjeta fechadas lejos del cierre', () => {
    const c = ctx(GALICIA_VISA_PAU_2, '2026-09-24');
    expect(cuotaDateAtClose(parsed({ date: '2026-03-25', description: 'X 03/06' }), c)).toBe('2026-09-24');
    expect(cuotaDateAtClose(parsed({ date: '2026-09-20', description: 'X 03/06' }), c)).toBeNull();
    expect(cuotaDateAtClose(parsed({ date: '2026-03-25', description: 'X' }), c)).toBeNull();
    expect(cuotaDateAtClose(parsed({ date: '2026-03-25', description: 'X 03/06' }), ctx(GALICIA_ARS_PAU))).toBeNull();
  });
});

describe('decideLine — duplicados', () => {
  it('rechaza una línea que ya existe como transacción y deja el marcador que lee la UI', () => {
    const d = decideLine(ctx(GALICIA_ARS_NICO), line({ isDuplicate: true, proposedCategoryId: CAT_X }));
    expect(d.action).toBe('reject');
    if (d.action === 'reject') expect(d.parsed.notes).toContain('[DUPLICADA]');
  });
});

describe('decideLine — conceptos bancarios inequívocos', () => {
  it('FIMA → transferencia con la cuenta de inversión Galicia del mismo dueño', () => {
    const d = decideLine(
      ctx(GALICIA_ARS_NICO),
      line({ parsed: { description: 'RESCATE FIMA - Fima Premium Clase A', kind: 'income' } }),
    );
    expect(d).toMatchObject({ action: 'edit', proposedCategoryId: null });
    if (d.action === 'edit') {
      expect(d.parsed.isTransfer).toBe(true);
      expect(d.parsed.transferAccountId).toBe(GALICIA_BROKER_NICO.id);
    }
  });

  it('pago de tarjeta → la tarjeta del mismo banco y dueño; con dos Visas queda sin contracuenta', () => {
    const nico = decideLine(ctx(GALICIA_ARS_NICO), line({ parsed: { description: 'PAGO TARJETA VISA - D.A. AL VTO' } }));
    expect(nico.action).toBe('edit');
    if (nico.action === 'edit') expect(nico.parsed.transferAccountId).toBe(GALICIA_VISA_NICO.id);

    const pau = decideLine(ctx(GALICIA_ARS_PAU), line({ parsed: { description: 'PAGO TARJETA VISA' } }));
    expect(pau.action).toBe('edit');
    if (pau.action === 'edit') {
      expect(pau.parsed.isTransfer).toBe(true);
      expect(pau.parsed.transferAccountId).toBeUndefined();
    }
  });

  it('intereses y promos bancarias → categoría, nunca transferencia', () => {
    const i = decideLine(
      ctx(GALICIA_ARS_NICO),
      line({ parsed: { description: 'INTERES CAPITALIZADO - SEPTIEMBRE 2026', kind: 'income', isTransfer: true } }),
    );
    expect(i).toMatchObject({ action: 'edit', proposedCategoryId: CAT_INTERESES });
    if (i.action === 'edit') expect(i.parsed.isTransfer).toBe(false);

    const p = decideLine(
      ctx(GALICIA_ARS_PAU),
      line({ parsed: { description: 'REINTEGRO PROMOCION GALICIA - 30% EN JUMBO', kind: 'income' } }),
    );
    expect(p).toMatchObject({ action: 'edit', proposedCategoryId: CAT_PROMOS });
  });

  it('BIND: compra de moneda extranjera → la otra caja propia; "entre cuentas" queda sin contracuenta', () => {
    const c = decideLine(ctx(BIND_ARS_PAU), line({ parsed: { description: 'COMPRA MONEDA EXTRANJERA', isTransfer: true } }));
    expect(c.action).toBe('edit');
    if (c.action === 'edit') expect(c.parsed.transferAccountId).toBe(BIND_USD_PAU.id);

    const e = decideLine(
      ctx(BIND_ARS_PAU),
      line({ parsed: { description: 'DÉBITO TRANSF ENTRE CUENTAS', isTransfer: true } }),
    );
    // Ya venía como transfer sin contracuenta y sin categoría: no hay nada que corregir.
    expect(e.action).toBe('accept');
  });
});

describe('decideLine — transferencias por contraparte', () => {
  it('contraparte del household → transferencia propia (con contracuenta si las refs la resuelven)', () => {
    const d = decideLine(
      ctx(GALICIA_ARS_PAU),
      line({
        parsed: {
          description: 'TRANSFERENCIA A TERCEROS - VARIOS',
          isTransfer: true,
          counterparty: { cuil: '20-11111111-2', name: 'NICO' },
        },
      }),
    );
    expect(d.action).toBe('edit');
    if (d.action === 'edit') expect(d.parsed.transferAccountId).toBe(GALICIA_ARS_NICO.id);
  });

  it('tercero con historial → gasto/ingreso con la categoría aprendida (deja de ser transfer)', () => {
    const d = decideLine(
      ctx(GALICIA_ARS_PAU),
      line({
        proposedCategoryId: CAT_X,
        historyCategoryId: CAT_HIST,
        parsed: {
          description: 'TRANSFERENCIA A TERCEROS - VARIOS',
          isTransfer: true,
          counterparty: { cuil: '27-99999999-9', name: 'JARDINERO' },
        },
      }),
    );
    expect(d).toMatchObject({ action: 'edit', proposedCategoryId: CAT_HIST });
    if (d.action === 'edit') expect(d.parsed.isTransfer).toBe(false);
  });

  it('tercero sin historial, o contraparte sin identificador fuerte → queda para revisión humana', () => {
    const c = ctx(GALICIA_ARS_PAU);
    expect(
      decideLine(
        c,
        line({ parsed: { description: 'TRANSFERENCIA A TERCEROS - VARIOS', isTransfer: true, counterparty: { cuil: '27-99999999-9' } } }),
      ).action,
    ).toBe('pending');
    expect(
      decideLine(
        c,
        line({
          historyCategoryId: CAT_HIST,
          parsed: { description: 'TRANSFERENCIA A TERCEROS - VARIOS', isTransfer: true, counterparty: { name: 'ALGUIEN' } },
        }),
      ).action,
    ).toBe('pending');
  });

  it('transferencia ya resuelta se acepta tal cual', () => {
    const d = decideLine(
      ctx(GALICIA_ARS_PAU),
      line({ parsed: { description: 'TRANSFERENCIA A TERCEROS - VARIOS', isTransfer: true, transferAccountId: GALICIA_ARS_NICO.id } }),
    );
    expect(d.action).toBe('accept');
  });
});

describe('helpers', () => {
  it('counterpartyHasStrongId exige CUIL/CBU/cuenta/alias, no solo nombre', () => {
    expect(counterpartyHasStrongId({ name: 'X' })).toBe(false);
    expect(counterpartyHasStrongId({ cbu: '0070999030005148307263' })).toBe(true);
  });

  it('counterpartyIsHousehold reconoce el CUIL de un miembro y las refs de una cuenta propia', () => {
    const c = ctx(GALICIA_ARS_PAU);
    expect(counterpartyIsHousehold(line({ parsed: { counterparty: { cuil: '20111111112' } } }), c)).toBe(true);
    expect(counterpartyIsHousehold(line({ parsed: { counterparty: { cbu: 'cbu-nico-ars' } } }), c)).toBe(true);
    expect(counterpartyIsHousehold(line({ parsed: { counterparty: { cuil: '27999999999' } } }), c)).toBe(false);
  });
});
