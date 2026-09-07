'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, useCallback } from 'react';
import Decimal from 'decimal.js';
import { toast } from 'sonner';
import { createSnapshot } from '@/app/actions/patrimonio/create-snapshot';
import { updateSnapshot } from '@/app/actions/patrimonio/update-snapshot';
import { fetchPrices } from '@/app/actions/patrimonio/fetch-prices';
import type {
  SnapshotDetail,
  SnapshotBalance,
  SnapshotHolding,
} from '@/lib/patrimonio/load-snapshot-detail';
import { ACCOUNT_TYPE_LABELS } from '@/lib/schemas/account';
import { formatAccount, type AccountForDisplay } from '@/lib/accounts/format';
import { Hair, Label, Display, Body, Num } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

interface AccountInfo {
  id: string;
  name: string;
  type: AccountForDisplay['type'];
  cardBrand: AccountForDisplay['cardBrand'];
  institutionName: string | null;
  currencyDefault: 'ARS' | 'USD';
  ownerTag: string;
}

/** Nombre legible de una cuenta de patrimonio. */
function accountLabel(
  a: AccountInfo,
  opts?: { withInstitution?: boolean; withOwner?: boolean; withCurrency?: boolean },
): string {
  return formatAccount(
    {
      institutionName: a.institutionName,
      type: a.type,
      cardBrand: a.cardBrand,
      name: a.name,
      ownerTag: a.ownerTag,
      currency: a.currencyDefault,
    },
    opts,
  );
}

interface BalanceRow {
  accountId: string;
  balance: string;
  currency: string;
  fxRateUsed: string;
  fxRateSource: string;
}

interface HoldingRow {
  key: string;
  accountId: string;
  ticker: string;
  name: string;
  assetType: string;
  quantity: string;
  pricePerUnit: string;
  currency: string;
  fxRateUsed: string;
  fxRateSource: string;
}

const ASSET_TYPE_LABELS: Record<string, string> = {
  stock: 'Acción',
  etf: 'ETF',
  bond: 'Bono',
  cedear: 'CEDEAR',
  fci: 'FCI',
  crypto: 'Crypto',
  other: 'Otro',
};

function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function computeUsd(amount: string, currency: string, fxRate: string): string {
  try {
    if (currency === 'USD') return new Decimal(amount || 0).toFixed(2);
    const rate = new Decimal(fxRate || 0);
    if (rate.isZero()) return '0.00';
    return new Decimal(amount || 0).div(rate).toFixed(2, Decimal.ROUND_HALF_UP);
  } catch {
    return '0.00';
  }
}

function totalNetWorth(balances: BalanceRow[], holdings: HoldingRow[]): Decimal {
  let total = new Decimal(0);
  for (const b of balances) {
    try {
      total = total.plus(computeUsd(b.balance, b.currency, b.fxRateUsed));
    } catch {
      /* skip invalid */
    }
  }
  for (const h of holdings) {
    try {
      const tv = new Decimal(h.quantity || 0).times(h.pricePerUnit || 0);
      total = total.plus(computeUsd(tv.toFixed(2), h.currency, h.fxRateUsed));
    } catch {
      /* skip invalid */
    }
  }
  return total;
}

let nextKey = 1;

interface SnapshotFormProps {
  accounts: AccountInfo[];
  previousDetail: SnapshotDetail | null;
  defaultFxRate: string | null;
  defaultDate: string;
  /** If editing an existing snapshot */
  editingId?: string;
  editingDetail?: SnapshotDetail;
}

export function SnapshotForm({
  accounts,
  previousDetail,
  defaultFxRate,
  defaultDate,
  editingId,
  editingDetail,
}: SnapshotFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fetchingPrices, setFetchingPrices] = useState(false);

  const sourceDetail = editingDetail ?? previousDetail;

  const [date, setDate] = useState(editingDetail?.date ?? defaultDate);
  const [notes, setNotes] = useState(editingDetail?.notes ?? '');

  // Initialize balances from source or empty
  const [balances, setBalances] = useState<BalanceRow[]>(() => {
    return accounts.map((acc) => {
      const prev = sourceDetail?.balances.find((b: SnapshotBalance) => b.accountId === acc.id);
      const fxRate = acc.currencyDefault === 'ARS' ? (prev?.fxRateUsed ?? defaultFxRate ?? '') : '';
      return {
        accountId: acc.id,
        balance: prev?.balance ?? '',
        currency: acc.currencyDefault,
        fxRateUsed: fxRate,
        fxRateSource: prev?.fxRateSource ?? (acc.currencyDefault === 'ARS' ? 'BCRA_mid' : ''),
      };
    });
  });

  // Initialize holdings from source or empty
  const [holdings, setHoldings] = useState<HoldingRow[]>(() => {
    if (sourceDetail && sourceDetail.holdings.length > 0) {
      return sourceDetail.holdings.map((h: SnapshotHolding) => ({
        key: `h-${nextKey++}`,
        accountId: h.accountId,
        ticker: h.ticker,
        name: h.name,
        assetType: h.assetType,
        quantity: h.quantity,
        pricePerUnit: h.pricePerUnit,
        currency: h.currency,
        fxRateUsed: h.fxRateUsed ?? (h.currency === 'ARS' ? (defaultFxRate ?? '') : ''),
        fxRateSource: h.fxRateSource ?? '',
      }));
    }
    return [];
  });

  const brokerAccounts = accounts.filter((a) => a.type === 'broker');

  const updateBalance = useCallback((accountId: string, field: keyof BalanceRow, value: string) => {
    setBalances((prev) =>
      prev.map((b) => (b.accountId === accountId ? { ...b, [field]: value } : b)),
    );
  }, []);

  const addHolding = useCallback(() => {
    const defaultBroker = brokerAccounts[0]?.id ?? '';
    const defaultCurrency = brokerAccounts[0]?.currencyDefault ?? 'USD';
    setHoldings((prev) => [
      ...prev,
      {
        key: `h-${nextKey++}`,
        accountId: defaultBroker,
        ticker: '',
        name: '',
        assetType: 'stock',
        quantity: '',
        pricePerUnit: '',
        currency: defaultCurrency,
        fxRateUsed: defaultCurrency === 'ARS' ? (defaultFxRate ?? '') : '',
        fxRateSource: '',
      },
    ]);
  }, [brokerAccounts, defaultFxRate]);

  const removeHolding = useCallback((key: string) => {
    setHoldings((prev) => prev.filter((h) => h.key !== key));
  }, []);

  const updateHolding = useCallback((key: string, field: keyof HoldingRow, value: string) => {
    setHoldings((prev) => prev.map((h) => (h.key === key ? { ...h, [field]: value } : h)));
  }, []);

  const handleFetchPrices = async () => {
    const tickers = holdings.map((h) => h.ticker).filter(Boolean);
    if (tickers.length === 0) {
      toast.error('No hay tickers para consultar');
      return;
    }
    setFetchingPrices(true);
    try {
      const result = await fetchPrices(tickers);
      if (!result.ok) {
        toast.error('Error al obtener precios');
        return;
      }
      setHoldings((prev) =>
        prev.map((h) => {
          const q = result.quotes[h.ticker];
          if (!q) return h;
          const currency = q.currency === 'ARS' ? 'ARS' : 'USD';
          return {
            ...h,
            pricePerUnit: q.price.toString(),
            currency,
            fxRateUsed: currency === 'ARS' ? (defaultFxRate ?? h.fxRateUsed) : '',
          };
        }),
      );
      toast.success(`Precios actualizados: ${Object.keys(result.quotes).length}/${tickers.length}`);
    } finally {
      setFetchingPrices(false);
    }
  };

  const nw = totalNetWorth(balances, holdings);

  const handleSubmit = () => {
    const input = {
      date,
      notes: notes || null,
      balances: balances
        .filter((b) => b.balance !== '')
        .map((b) => ({
          accountId: b.accountId,
          balance: b.balance,
          currency: b.currency,
          fxRateUsed: b.fxRateUsed || null,
          fxRateSource: b.fxRateSource || null,
        })),
      holdings: holdings
        .filter((h) => h.ticker && h.quantity && h.pricePerUnit)
        .map((h) => ({
          accountId: h.accountId,
          ticker: h.ticker,
          name: h.name || h.ticker,
          assetType: h.assetType,
          quantity: h.quantity,
          pricePerUnit: h.pricePerUnit,
          currency: h.currency,
          fxRateUsed: h.fxRateUsed || null,
          fxRateSource: h.fxRateSource || null,
        })),
    };

    startTransition(async () => {
      const result = editingId
        ? await updateSnapshot(editingId, input)
        : await createSnapshot(input);

      if (result.ok) {
        toast.success(editingId ? 'Snapshot actualizado' : 'Snapshot creado');
        if (!editingId && 'id' in result) {
          router.push(`/patrimonio/${result.id}`);
        } else {
          router.push('/patrimonio');
        }
      } else if (result.error === 'duplicate_date') {
        toast.error('Ya existe un snapshot para esa fecha');
      } else if (result.error === 'invalid_input') {
        toast.error('Datos inválidos — revisá los campos');
      } else {
        toast.error('Error al guardar');
      }
    });
  };

  // Group accounts by type for display
  const accountsByType = new Map<string, AccountInfo[]>();
  for (const acc of accounts) {
    const list = accountsByType.get(acc.type) ?? [];
    list.push(acc);
    accountsByType.set(acc.type, list);
  }

  return (
    <div className="space-y-8">
      {/* Date */}
      <div className="max-w-xs">
        <label className="text-muted-foreground block font-sans text-xs font-semibold tracking-widest uppercase">
          Fecha del snapshot
        </label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border-border bg-card text-foreground mt-2 w-full border px-3 py-2 font-mono text-sm"
        />
      </div>

      <Hair thick />

      {/* ========== BALANCES ========== */}
      <section>
        <Display size="md">Saldos de cuentas</Display>
        <Body className="mt-1">
          Ingresá el saldo actual de cada cuenta. TC como saldo negativo (deuda).
        </Body>

        <div className="mt-4 space-y-6">
          {Array.from(accountsByType.entries()).map(([type, accs]) => (
            <div key={type}>
              <Label>{ACCOUNT_TYPE_LABELS[type as keyof typeof ACCOUNT_TYPE_LABELS] ?? type}</Label>
              <div className="mt-2 space-y-2">
                {accs.map((acc) => {
                  const row = balances.find((b) => b.accountId === acc.id)!;
                  const usd = computeUsd(row.balance, row.currency, row.fxRateUsed);
                  return (
                    <div
                      key={acc.id}
                      className="border-border/30 grid grid-cols-[1fr_120px_100px_80px] items-center gap-3 border-b pb-2"
                    >
                      <div>
                        <span className="font-display text-foreground text-sm">
                          {accountLabel(acc, { withOwner: false, withCurrency: false })}
                        </span>
                        <span className="text-muted-foreground ml-2 font-sans text-[9px] tracking-wide uppercase">
                          {acc.ownerTag} · {acc.currencyDefault}
                        </span>
                      </div>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.balance}
                        onChange={(e) => updateBalance(acc.id, 'balance', e.target.value)}
                        placeholder={type === 'credit_card' ? '-0.00' : '0.00'}
                        className="border-border bg-card text-foreground border px-2 py-1.5 text-right font-mono text-sm"
                      />
                      {row.currency === 'ARS' ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.fxRateUsed}
                          onChange={(e) => updateBalance(acc.id, 'fxRateUsed', e.target.value)}
                          placeholder="FX"
                          className="border-border bg-card text-muted-foreground border px-2 py-1.5 text-right font-mono text-xs"
                        />
                      ) : (
                        <div />
                      )}
                      <Num className="text-muted-foreground text-right text-xs">
                        {row.balance ? formatUsd(Number.parseFloat(usd)) : '—'}
                      </Num>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <Hair thick />

      {/* ========== HOLDINGS ========== */}
      {brokerAccounts.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between">
            <Display size="md">Holdings</Display>
            <div className="flex gap-3">
              {holdings.length > 0 && (
                <button
                  type="button"
                  onClick={handleFetchPrices}
                  disabled={fetchingPrices}
                  className="border-border font-display text-muted-foreground hover:bg-card hover:text-foreground inline-flex items-center gap-1 border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  {fetchingPrices ? 'Consultando...' : 'Actualizar precios'}
                </button>
              )}
              <button
                type="button"
                onClick={addHolding}
                className="bg-primary/10 font-display text-primary hover:bg-primary/20 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold transition-colors"
              >
                + Agregar holding
              </button>
            </div>
          </div>
          <Body className="mt-1">
            Detalle de tenencias en brokers. Usá &quot;Actualizar precios&quot; para traer
            cotizaciones de Yahoo Finance.
          </Body>

          {holdings.length === 0 ? (
            <Body className="mt-4 text-center">Sin holdings. Agregá uno para empezar.</Body>
          ) : (
            <div className="mt-4 space-y-3">
              {holdings.map((h) => {
                const tv = (() => {
                  try {
                    return new Decimal(h.quantity || 0).times(h.pricePerUnit || 0);
                  } catch {
                    return new Decimal(0);
                  }
                })();
                const tvUsd = computeUsd(tv.toFixed(2), h.currency, h.fxRateUsed);
                return (
                  <div key={h.key} className="border-border/60 bg-card/30 border p-3">
                    <div className="grid grid-cols-[100px_1fr_100px_80px_auto] items-center gap-2">
                      {/* Ticker */}
                      <input
                        type="text"
                        value={h.ticker}
                        onChange={(e) =>
                          updateHolding(h.key, 'ticker', e.target.value.toUpperCase())
                        }
                        placeholder="AAPL"
                        className="border-border bg-card text-foreground border px-2 py-1.5 font-mono text-sm uppercase"
                      />
                      {/* Name */}
                      <input
                        type="text"
                        value={h.name}
                        onChange={(e) => updateHolding(h.key, 'name', e.target.value)}
                        placeholder="Apple Inc."
                        className="border-border bg-card text-foreground border px-2 py-1.5 text-sm"
                      />
                      {/* Type */}
                      <select
                        value={h.assetType}
                        onChange={(e) => updateHolding(h.key, 'assetType', e.target.value)}
                        className="border-border bg-card text-foreground border px-2 py-1.5 text-xs"
                      >
                        {Object.entries(ASSET_TYPE_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                      {/* Broker */}
                      <select
                        value={h.accountId}
                        onChange={(e) => updateHolding(h.key, 'accountId', e.target.value)}
                        className="border-border bg-card text-foreground border px-2 py-1.5 text-xs"
                      >
                        {brokerAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {accountLabel(a)}
                          </option>
                        ))}
                      </select>
                      {/* Remove */}
                      <button
                        type="button"
                        onClick={() => removeHolding(h.key)}
                        className="text-muted-foreground px-2 py-1 text-sm hover:text-[color:var(--bad)]"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-[120px_120px_80px_80px_1fr] items-center gap-2">
                      {/* Quantity */}
                      <div>
                        <span className="text-muted-foreground block font-sans text-[9px] tracking-wide uppercase">
                          Cantidad
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={h.quantity}
                          onChange={(e) => updateHolding(h.key, 'quantity', e.target.value)}
                          placeholder="0"
                          className="border-border bg-card text-foreground mt-0.5 w-full border px-2 py-1.5 text-right font-mono text-sm"
                        />
                      </div>
                      {/* Price */}
                      <div>
                        <span className="text-muted-foreground block font-sans text-[9px] tracking-wide uppercase">
                          Precio
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={h.pricePerUnit}
                          onChange={(e) => updateHolding(h.key, 'pricePerUnit', e.target.value)}
                          placeholder="0.00"
                          className="border-border bg-card text-foreground mt-0.5 w-full border px-2 py-1.5 text-right font-mono text-sm"
                        />
                      </div>
                      {/* Currency */}
                      <div>
                        <span className="text-muted-foreground block font-sans text-[9px] tracking-wide uppercase">
                          Moneda
                        </span>
                        <select
                          value={h.currency}
                          onChange={(e) => updateHolding(h.key, 'currency', e.target.value)}
                          className="border-border bg-card text-foreground mt-0.5 w-full border px-2 py-1.5 text-xs"
                        >
                          <option value="USD">USD</option>
                          <option value="ARS">ARS</option>
                        </select>
                      </div>
                      {/* FX (if ARS) */}
                      <div>
                        {h.currency === 'ARS' && (
                          <>
                            <span className="text-muted-foreground block font-sans text-[9px] tracking-wide uppercase">
                              FX
                            </span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={h.fxRateUsed}
                              onChange={(e) => updateHolding(h.key, 'fxRateUsed', e.target.value)}
                              className="border-border bg-card text-muted-foreground mt-0.5 w-full border px-2 py-1.5 text-right font-mono text-xs"
                            />
                          </>
                        )}
                      </div>
                      {/* Total */}
                      <div className="text-right">
                        <span className="text-muted-foreground block font-sans text-[9px] tracking-wide uppercase">
                          Total USD
                        </span>
                        <Num className="text-foreground mt-1 text-sm">
                          {h.quantity && h.pricePerUnit ? formatUsd(Number.parseFloat(tvUsd)) : '—'}
                        </Num>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <Hair thick />

      {/* ========== NOTES ========== */}
      <div className="max-w-xl">
        <label className="text-muted-foreground block font-sans text-xs font-semibold tracking-widest uppercase">
          Notas (opcional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={2000}
          className="border-border bg-card text-foreground mt-2 w-full border px-3 py-2 text-sm"
          placeholder="Observaciones sobre este snapshot..."
        />
      </div>

      <Hair thick />

      {/* ========== FOOTER: total + submit ========== */}
      <footer className="flex items-center justify-between">
        <div>
          <Label>Net worth total</Label>
          <Display
            size="lg"
            className={cn(
              'mt-2 block tabular-nums',
              nw.isNegative() ? 'text-[color:var(--bad)]' : 'text-primary',
            )}
          >
            {formatUsd(nw.toNumber())}
          </Display>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => router.push('/patrimonio')}
            className="border-border font-display text-muted-foreground hover:bg-card border px-5 py-2.5 text-sm transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="bg-primary font-display text-primary-foreground hover:bg-primary/90 px-6 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {isPending ? 'Guardando...' : editingId ? 'Actualizar' : 'Guardar snapshot'}
          </button>
        </div>
      </footer>
    </div>
  );
}
