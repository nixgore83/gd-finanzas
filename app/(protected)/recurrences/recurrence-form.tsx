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
  RECURRENCE_FREQUENCIES,
  RECURRENCE_FREQUENCY_LABELS,
  RECURRENCE_KINDS,
  RECURRENCE_KIND_LABELS,
  type RecurrenceFrequency,
  type RecurrenceKind,
} from '@/lib/schemas/recurrence';

type AccountOption = { id: string; name: string; currencyDefault: 'ARS' | 'USD' };
type CategoryOption = { id: string; name: string; kind: 'income' | 'expense'; depth: 0 | 1 };

type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; fields?: Record<string, string> };

type Initial = {
  name: string;
  accountId: string;
  categoryId: string;
  kind: RecurrenceKind;
  amount: string;
  currency: 'ARS' | 'USD';
  frequency: RecurrenceFrequency;
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  active: boolean;
};

type Props = {
  accounts: AccountOption[];
  categories: CategoryOption[];
  action: (formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  title: string;
  description: string;
  initial?: Initial;
  hiddenId?: string;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RecurrenceForm({
  accounts,
  categories,
  action,
  submitLabel,
  title,
  description,
  initial,
  hiddenId,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const firstAccount = accounts[0];
  const initialKind: RecurrenceKind = initial?.kind ?? 'expense';
  const [kind, setKind] = useState<RecurrenceKind>(initialKind);

  const [accountId, setAccountId] = useState<string>(
    initial?.accountId ?? firstAccount?.id ?? '',
  );

  const filteredCategories = useMemo(
    () => categories.filter((c) => c.kind === kind),
    [categories, kind],
  );
  const [categoryId, setCategoryId] = useState<string>(
    initial?.categoryId || filteredCategories[0]?.id || '',
  );

  const [currency, setCurrency] = useState<'ARS' | 'USD'>(
    initial?.currency ?? firstAccount?.currencyDefault ?? 'ARS',
  );

  const [frequency, setFrequency] = useState<RecurrenceFrequency>(initial?.frequency ?? 'monthly');
  const [active, setActive] = useState<boolean>(initial?.active ?? true);

  function handleKindChange(next: string) {
    const nextKind = next as RecurrenceKind;
    setKind(nextKind);
    const stillValid = categories.some((c) => c.id === categoryId && c.kind === nextKind);
    if (!stillValid) {
      const firstForKind = categories.find((c) => c.kind === nextKind);
      setCategoryId(firstForKind?.id ?? '');
    }
  }

  function handleAccountChange(next: string) {
    setAccountId(next);
    if (!initial) {
      const acc = accounts.find((a) => a.id === next);
      if (acc) setCurrency(acc.currencyDefault);
    }
  }

  function handleSubmit(formData: FormData) {
    formData.set('kind', kind);
    formData.set('accountId', accountId);
    formData.set('categoryId', categoryId);
    formData.set('currency', currency);
    formData.set('frequency', frequency);
    formData.set('active', active ? 'true' : 'false');
    if (hiddenId) formData.set('id', hiddenId);

    setErrors({});
    startTransition(async () => {
      const result = await action(formData);
      if (result.ok) {
        toast.success(hiddenId ? 'Recurrencia actualizada' : 'Recurrencia creada');
        router.push('/recurrences');
        router.refresh();
        return;
      }
      if ((result.error === 'invalid_input' || result.error === 'invalid_refs') && result.fields) {
        setErrors(result.fields);
        toast.error(
          result.error === 'invalid_refs' ? 'Referencia inválida' : 'Revisá los campos marcados',
        );
        return;
      }
      if (result.error === 'not_found') {
        toast.error('La recurrencia no existe o no es tuya');
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
          <div className="space-y-2">
            <Label htmlFor="name">Nombre</Label>
            <Input
              id="name"
              name="name"
              required
              maxLength={80}
              defaultValue={initial?.name ?? ''}
              disabled={isPending}
              placeholder="Sueldo Nico, expensas, etc."
              aria-invalid={errors.name ? true : undefined}
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="kind">Tipo</Label>
              <Select value={kind} onValueChange={handleKindChange} disabled={isPending}>
                <SelectTrigger id="kind" aria-invalid={errors.kind ? true : undefined}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECURRENCE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {RECURRENCE_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.kind && <p className="text-sm text-destructive">{errors.kind}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="frequency">Frecuencia</Label>
              <Select
                value={frequency}
                onValueChange={(v) => setFrequency(v as RecurrenceFrequency)}
                disabled={isPending}
              >
                <SelectTrigger
                  id="frequency"
                  aria-invalid={errors.frequency ? true : undefined}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECURRENCE_FREQUENCIES.map((f) => (
                    <SelectItem key={f} value={f}>
                      {RECURRENCE_FREQUENCY_LABELS[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.frequency && <p className="text-sm text-destructive">{errors.frequency}</p>}
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
              <SelectTrigger id="categoryId" aria-invalid={errors.categoryId ? true : undefined}>
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
            {errors.categoryId && <p className="text-sm text-destructive">{errors.categoryId}</p>}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="amount">Monto</Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                step="0.01"
                min="0"
                required
                defaultValue={initial?.amount ?? ''}
                disabled={isPending}
                placeholder="0.00"
                aria-invalid={errors.amount ? true : undefined}
              />
              {errors.amount && <p className="text-sm text-destructive">{errors.amount}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Moneda</Label>
              <Select
                value={currency}
                onValueChange={(v) => setCurrency(v as 'ARS' | 'USD')}
                disabled={isPending}
              >
                <SelectTrigger
                  id="currency"
                  aria-invalid={errors.currency ? true : undefined}
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
              {errors.currency && <p className="text-sm text-destructive">{errors.currency}</p>}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="dayOfMonth">Día del mes</Label>
              <Input
                id="dayOfMonth"
                name="dayOfMonth"
                type="number"
                min="1"
                max="31"
                required
                defaultValue={initial?.dayOfMonth ?? 1}
                disabled={isPending}
                aria-invalid={errors.dayOfMonth ? true : undefined}
              />
              {errors.dayOfMonth && (
                <p className="text-sm text-destructive">{errors.dayOfMonth}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="startDate">Inicio</Label>
              <Input
                id="startDate"
                name="startDate"
                type="date"
                required
                defaultValue={initial?.startDate ?? todayIso()}
                disabled={isPending}
                aria-invalid={errors.startDate ? true : undefined}
              />
              {errors.startDate && (
                <p className="text-sm text-destructive">{errors.startDate}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">Fin (opcional)</Label>
              <Input
                id="endDate"
                name="endDate"
                type="date"
                defaultValue={initial?.endDate ?? ''}
                disabled={isPending}
                aria-invalid={errors.endDate ? true : undefined}
              />
              {errors.endDate && <p className="text-sm text-destructive">{errors.endDate}</p>}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="active"
              name="active"
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              disabled={isPending}
            />
            <Label htmlFor="active">Activa (genera previsiones)</Label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" asChild disabled={isPending}>
              <Link href="/recurrences">Cancelar</Link>
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
