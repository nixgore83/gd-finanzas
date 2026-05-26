'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CURRENCIES } from '@/lib/schemas/account';
import {
  DOMESTIC_SERVICE_CONCEPTOS,
  TRANSACTION_KINDS,
  TRANSACTION_KIND_LABELS,
  TRANSACTION_SUBTYPES,
  TRANSACTION_SUBTYPE_LABELS,
  type DomesticServiceConcepto,
  type DomesticServiceMeta,
  type TransactionKind,
  type TransactionSubtype,
} from '@/lib/schemas/transaction';
import { cn } from '@/lib/utils';
import { TagMultiSelect, type TagOption } from './tag-multi-select';

type AccountOption = { id: string; name: string; currencyDefault: 'ARS' | 'USD' };
type CategoryOption = { id: string; name: string; kind: 'income' | 'expense'; depth: 0 | 1 };

type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; fields?: Record<string, string> };

type Initial = {
  date: string;
  accountId: string;
  categoryId: string;
  kind: TransactionKind;
  amountOriginal: string;
  currencyOriginal: 'ARS' | 'USD';
  description: string;
  notes: string | null;
  tagIds?: string[];
  transactionSubtype?: TransactionSubtype;
  deducibleGanancias?: boolean;
  meta?: DomesticServiceMeta | null;
};

type FxInfo = {
  fxRateUsed: string;
  fxRateSource: string;
};

type Props = {
  accounts: AccountOption[];
  categories: CategoryOption[];
  availableTags: TagOption[];
  action: (formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  title: string;
  description: string;
  initial?: Initial;
  hiddenId?: string;
  initialFxInfo?: FxInfo;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function TransactionForm({
  accounts,
  categories,
  availableTags,
  action,
  submitLabel,
  title,
  description,
  initial,
  hiddenId,
  initialFxInfo,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(initial?.tagIds ?? []);

  const firstAccount = accounts[0];
  const initialKind: TransactionKind = initial?.kind ?? 'expense';
  const [kind, setKind] = useState<TransactionKind>(initialKind);

  const [accountId, setAccountId] = useState<string>(
    initial?.accountId ?? firstAccount?.id ?? '',
  );

  const filteredCategories = useMemo(
    () => categories.filter((c) => c.kind === kind),
    [categories, kind],
  );
  const [categoryId, setCategoryId] = useState<string>(
    initial?.categoryId ?? filteredCategories[0]?.id ?? '',
  );

  const [currencyOriginal, setCurrencyOriginal] = useState<'ARS' | 'USD'>(
    initial?.currencyOriginal ?? firstAccount?.currencyDefault ?? 'ARS',
  );

  const [transactionSubtype, setTransactionSubtype] = useState<TransactionSubtype>(
    initial?.transactionSubtype ?? 'standard',
  );
  const [deducibleGanancias, setDeducibleGanancias] = useState<boolean>(
    initial?.deducibleGanancias ?? false,
  );
  const [metaEmpleadoNombre, setMetaEmpleadoNombre] = useState<string>(
    initial?.meta?.empleado_nombre ?? '',
  );
  const [metaEmpleadoCuil, setMetaEmpleadoCuil] = useState<string>(
    initial?.meta?.empleado_cuil ?? '',
  );
  const [metaConcepto, setMetaConcepto] = useState<DomesticServiceConcepto>(
    initial?.meta?.concepto ?? 'sueldo',
  );
  const [metaPeriodo, setMetaPeriodo] = useState<string>(initial?.meta?.periodo ?? '');

  function handleKindChange(next: string) {
    const nextKind = next as TransactionKind;
    setKind(nextKind);
    const stillValid = categories.some((c) => c.id === categoryId && c.kind === nextKind);
    if (!stillValid) {
      const firstForKind = categories.find((c) => c.kind === nextKind);
      setCategoryId(firstForKind?.id ?? '');
    }
    // Servicio doméstico solo aplica a expense; al pasar a income reseteamos.
    if (nextKind !== 'expense' && transactionSubtype === 'domestic_service') {
      setTransactionSubtype('standard');
    }
  }

  function handleAccountChange(next: string) {
    setAccountId(next);
    if (!initial) {
      // En modo "nueva": auto-adopta la moneda de la cuenta elegida.
      // En modo "edit": no pisar la moneda original guardada.
      const acc = accounts.find((a) => a.id === next);
      if (acc) setCurrencyOriginal(acc.currencyDefault);
    }
  }

  function handleSubmit(formData: FormData) {
    formData.set('kind', kind);
    formData.set('accountId', accountId);
    formData.set('categoryId', categoryId);
    formData.set('currencyOriginal', currencyOriginal);
    formData.set('transactionSubtype', transactionSubtype);
    formData.set('deducibleGanancias', deducibleGanancias ? '1' : '');
    if (transactionSubtype === 'domestic_service') {
      formData.set('meta_empleado_nombre', metaEmpleadoNombre);
      formData.set('meta_empleado_cuil', metaEmpleadoCuil);
      formData.set('meta_concepto', metaConcepto);
      formData.set('meta_periodo', metaPeriodo);
    }
    formData.delete('tagIds');
    selectedTagIds.forEach((id) => formData.append('tagIds', id));
    if (hiddenId) formData.set('id', hiddenId);

    setErrors({});
    startTransition(async () => {
      const result = await action(formData);
      if (result.ok) {
        toast.success(hiddenId ? 'Transacción actualizada' : 'Transacción creada');
        router.push('/transactions');
        router.refresh();
        return;
      }
      if (
        (result.error === 'invalid_input' ||
          result.error === 'invalid_refs' ||
          result.error === 'fx_unavailable') &&
        result.fields
      ) {
        setErrors(result.fields);
        const labels: Record<string, string> = {
          invalid_input: 'Revisá los campos marcados',
          invalid_refs: 'Referencia inválida (cuenta/categoría)',
          fx_unavailable: 'No hay cotización para esa fecha',
        };
        toast.error(labels[result.error] ?? 'Error');
        return;
      }
      if (result.error === 'not_found') {
        toast.error('La transacción no existe o no es tuya');
        return;
      }
      toast.error('No pudimos guardar. Probá de nuevo.');
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="kind">Tipo</Label>
              <Select value={kind} onValueChange={handleKindChange} disabled={isPending}>
                <SelectTrigger id="kind" aria-invalid={errors.kind ? true : undefined}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRANSACTION_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {TRANSACTION_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.kind && <p className="text-sm text-destructive">{errors.kind}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Fecha</Label>
              <Input
                id="date"
                name="date"
                type="date"
                required
                defaultValue={initial?.date ?? todayIso()}
                disabled={isPending}
                aria-invalid={errors.date ? true : undefined}
              />
              {errors.date && <p className="text-sm text-destructive">{errors.date}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="accountId">Cuenta</Label>
            <Select value={accountId} onValueChange={handleAccountChange} disabled={isPending}>
              <SelectTrigger id="accountId" aria-invalid={errors.accountId ? true : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} ({a.currencyDefault})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.accountId && <p className="text-sm text-destructive">{errors.accountId}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="categoryId">Categoría</Label>
            <Select value={categoryId} onValueChange={setCategoryId} disabled={isPending}>
              <SelectTrigger
                id="categoryId"
                aria-invalid={errors.categoryId ? true : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {filteredCategories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span style={c.depth === 1 ? { paddingLeft: '1rem' } : undefined}>
                      {c.depth === 1 ? '↳ ' : ''}
                      {c.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.categoryId && (
              <p className="text-sm text-destructive">{errors.categoryId}</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="amountOriginal">Monto</Label>
              <Input
                id="amountOriginal"
                name="amountOriginal"
                type="number"
                step="0.01"
                required
                defaultValue={initial?.amountOriginal ?? ''}
                disabled={isPending}
                placeholder="0.00"
                aria-invalid={errors.amountOriginal ? true : undefined}
              />
              {errors.amountOriginal && (
                <p className="text-sm text-destructive">{errors.amountOriginal}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="currencyOriginal">Moneda</Label>
              <Select
                value={currencyOriginal}
                onValueChange={(v) => setCurrencyOriginal(v as 'ARS' | 'USD')}
                disabled={isPending}
              >
                <SelectTrigger
                  id="currencyOriginal"
                  aria-invalid={errors.currencyOriginal ? true : undefined}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.currencyOriginal && (
                <p className="text-sm text-destructive">{errors.currencyOriginal}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descripción</Label>
            <Input
              id="description"
              name="description"
              required
              maxLength={200}
              defaultValue={initial?.description ?? ''}
              disabled={isPending}
              placeholder="Supermercado, sueldo, alquiler…"
              aria-invalid={errors.description ? true : undefined}
            />
            {errors.description && (
              <p className="text-sm text-destructive">{errors.description}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notas (opcional)</Label>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              maxLength={500}
              defaultValue={initial?.notes ?? ''}
              disabled={isPending}
              className={cn(
                'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
              )}
              aria-invalid={errors.notes ? true : undefined}
            />
            {errors.notes && <p className="text-sm text-destructive">{errors.notes}</p>}
          </div>

          <TagMultiSelect
            tags={availableTags}
            value={selectedTagIds}
            onChange={setSelectedTagIds}
            disabled={isPending}
          />
          {errors.tagIds && <p className="text-sm text-destructive">{errors.tagIds}</p>}

          <div className="space-y-2 rounded-md border bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <input
                id="deducibleGanancias"
                type="checkbox"
                checked={deducibleGanancias}
                onChange={(e) => setDeducibleGanancias(e.target.checked)}
                disabled={isPending}
                className="size-4 rounded border-input"
              />
              <Label htmlFor="deducibleGanancias" className="cursor-pointer">
                Deducible Ganancias
              </Label>
            </div>

            {kind === 'expense' && (
              <div className="space-y-2">
                <Label htmlFor="transactionSubtype">Subtipo</Label>
                <Select
                  value={transactionSubtype}
                  onValueChange={(v) => setTransactionSubtype(v as TransactionSubtype)}
                  disabled={isPending}
                >
                  <SelectTrigger id="transactionSubtype">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRANSACTION_SUBTYPES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {TRANSACTION_SUBTYPE_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {transactionSubtype === 'domestic_service' && kind === 'expense' && (
              <div className="space-y-3 rounded-md border bg-background p-3">
                <p className="text-xs text-muted-foreground">
                  Datos del empleado para el export del contador (CSV 03).
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="meta_empleado_nombre">Empleado</Label>
                    <Input
                      id="meta_empleado_nombre"
                      value={metaEmpleadoNombre}
                      onChange={(e) => setMetaEmpleadoNombre(e.target.value)}
                      disabled={isPending}
                      placeholder="Nombre completo"
                      aria-invalid={errors.meta ? true : undefined}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="meta_empleado_cuil">CUIL</Label>
                    <Input
                      id="meta_empleado_cuil"
                      value={metaEmpleadoCuil}
                      onChange={(e) => setMetaEmpleadoCuil(e.target.value)}
                      disabled={isPending}
                      placeholder="##-########-#"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="meta_concepto">Concepto</Label>
                    <Select
                      value={metaConcepto}
                      onValueChange={(v) => setMetaConcepto(v as DomesticServiceConcepto)}
                      disabled={isPending}
                    >
                      <SelectTrigger id="meta_concepto">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DOMESTIC_SERVICE_CONCEPTOS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="meta_periodo">Período (YYYY-MM)</Label>
                    <Input
                      id="meta_periodo"
                      type="month"
                      value={metaPeriodo}
                      onChange={(e) => setMetaPeriodo(e.target.value)}
                      disabled={isPending}
                      placeholder="2026-05"
                    />
                  </div>
                </div>
                {errors.meta && <p className="text-sm text-destructive">{errors.meta}</p>}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="fxRateOverride">FX rate (opcional — sobrescribe BCRA)</Label>
            <Input
              id="fxRateOverride"
              name="fxRateOverride"
              type="number"
              step="0.0001"
              min="0"
              disabled={isPending}
              placeholder="dejar vacío para usar BCRA"
              aria-invalid={errors.fxRateOverride ? true : undefined}
            />
            {initialFxInfo && (
              <p className="text-xs text-muted-foreground">
                Cotización usada actualmente:{' '}
                <span className="font-mono">{initialFxInfo.fxRateUsed}</span> (
                {initialFxInfo.fxRateSource}). Vacío = recomputar con BCRA del día.
              </p>
            )}
            {errors.fxRateOverride && (
              <p className="text-sm text-destructive">{errors.fxRateOverride}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" asChild disabled={isPending}>
              <Link href="/transactions">Cancelar</Link>
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Guardando…' : submitLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
