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
  TRANSACTION_KINDS,
  TRANSACTION_KIND_LABELS,
  type TransactionKind,
} from '@/lib/schemas/transaction';
import { cn } from '@/lib/utils';

type AccountOption = { id: string; name: string; currencyDefault: 'ARS' | 'USD' };
type CategoryOption = { id: string; name: string; kind: 'income' | 'expense' };

type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; fields?: Record<string, string> };

type Props = {
  accounts: AccountOption[];
  categories: CategoryOption[];
  action: (formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  title: string;
  description: string;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function TransactionForm({
  accounts,
  categories,
  action,
  submitLabel,
  title,
  description,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [kind, setKind] = useState<TransactionKind>('expense');
  const firstAccount = accounts[0];
  const [accountId, setAccountId] = useState<string>(firstAccount?.id ?? '');
  const filteredCategories = useMemo(
    () => categories.filter((c) => c.kind === kind),
    [categories, kind],
  );
  const [categoryId, setCategoryId] = useState<string>(filteredCategories[0]?.id ?? '');
  const [currencyOriginal, setCurrencyOriginal] = useState<'ARS' | 'USD'>(
    firstAccount?.currencyDefault ?? 'ARS',
  );

  function handleKindChange(next: string) {
    const nextKind = next as TransactionKind;
    setKind(nextKind);
    // Reset category if no longer compatible.
    const stillValid = categories.some((c) => c.id === categoryId && c.kind === nextKind);
    if (!stillValid) {
      const firstForKind = categories.find((c) => c.kind === nextKind);
      setCategoryId(firstForKind?.id ?? '');
    }
  }

  function handleAccountChange(next: string) {
    setAccountId(next);
    const acc = accounts.find((a) => a.id === next);
    if (acc) setCurrencyOriginal(acc.currencyDefault);
  }

  function handleSubmit(formData: FormData) {
    formData.set('kind', kind);
    formData.set('accountId', accountId);
    formData.set('categoryId', categoryId);
    formData.set('currencyOriginal', currencyOriginal);

    setErrors({});
    startTransition(async () => {
      const result = await action(formData);
      if (result.ok) {
        toast.success('Transacción creada');
        router.push('/transactions');
        router.refresh();
        return;
      }
      if (result.error === 'invalid_input' && result.fields) {
        setErrors(result.fields);
        toast.error('Revisá los campos marcados');
        return;
      }
      if (result.error === 'invalid_refs' && result.fields) {
        setErrors(result.fields);
        toast.error('Referencia inválida (cuenta/categoría)');
        return;
      }
      if (result.error === 'fx_unavailable' && result.fields) {
        setErrors(result.fields);
        toast.error('No hay cotización para esa fecha');
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
                defaultValue={todayIso()}
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
                    {c.name}
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
                min="0"
                required
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
              disabled={isPending}
              className={cn(
                'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
              )}
              aria-invalid={errors.notes ? true : undefined}
            />
            {errors.notes && <p className="text-sm text-destructive">{errors.notes}</p>}
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
