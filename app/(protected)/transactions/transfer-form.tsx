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
import { cn } from '@/lib/utils';
import { TagMultiSelect, type TagOption } from './tag-multi-select';

type AccountOption = { id: string; name: string; currencyDefault: 'ARS' | 'USD'; ownerTag: string };

type ActionResult =
  | { ok: true; pairId?: string }
  | { ok: false; error: string; fields?: Record<string, string> };

type Initial = {
  date: string;
  accountFromId: string;
  accountToId: string;
  amountFrom: string;
  amountTo: string;
  description: string;
  notes: string | null;
  tagIds?: string[];
};

type FxInfo = { fxRateUsed: string; fxRateSource: string };

type Props = {
  accounts: AccountOption[];
  availableTags: TagOption[];
  action: (formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  title: string;
  description: string;
  initial?: Initial;
  hiddenId?: string;
  disableAccounts?: boolean;
  initialFxInfo?: FxInfo;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function TransferForm({
  accounts,
  availableTags,
  action,
  submitLabel,
  title,
  description,
  initial,
  hiddenId,
  disableAccounts,
  initialFxInfo,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(initial?.tagIds ?? []);

  const firstAccount = accounts[0];
  const secondAccount = accounts[1];

  const [accountFromId, setAccountFromId] = useState<string>(
    initial?.accountFromId ?? firstAccount?.id ?? '',
  );
  const [accountToId, setAccountToId] = useState<string>(
    initial?.accountToId ?? secondAccount?.id ?? '',
  );

  const fromAcc = useMemo(
    () => accounts.find((a) => a.id === accountFromId),
    [accounts, accountFromId],
  );
  const toAcc = useMemo(
    () => accounts.find((a) => a.id === accountToId),
    [accounts, accountToId],
  );

  const sameCurrency = fromAcc && toAcc && fromAcc.currencyDefault === toAcc.currencyDefault;

  const [amountFrom, setAmountFrom] = useState<string>(initial?.amountFrom ?? '');
  const [amountTo, setAmountTo] = useState<string>(initial?.amountTo ?? '');
  const [amountToTouched, setAmountToTouched] = useState<boolean>(Boolean(initial?.amountTo));

  // Auto-sync amountTo cuando misma moneda y el user no lo editó manualmente.
  // Lo hacemos en el handler de amountFrom (no en useEffect) para evitar
  // setState durante render.
  function handleAmountFromChange(value: string) {
    setAmountFrom(value);
    if (sameCurrency && !amountToTouched) setAmountTo(value);
  }

  function handleSubmit(formData: FormData) {
    formData.set('accountFromId', accountFromId);
    formData.set('accountToId', accountToId);
    formData.delete('tagIds');
    selectedTagIds.forEach((id) => formData.append('tagIds', id));
    if (hiddenId) formData.set('id', hiddenId);

    setErrors({});
    startTransition(async () => {
      const result = await action(formData);
      if (result.ok) {
        toast.success(hiddenId ? 'Transferencia actualizada' : 'Transferencia creada');
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
          invalid_refs: 'Referencia inválida (cuenta)',
          fx_unavailable: 'No hay cotización para esa fecha',
        };
        toast.error(labels[result.error] ?? 'Error');
        return;
      }
      if (result.error === 'not_found') {
        toast.error('La transferencia no existe o no es tuya');
        return;
      }
      if (result.error === 'mismatched_accounts') {
        toast.error('Las cuentas no pueden cambiarse en edit. Borrá y volvé a crear.');
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="accountFromId">Desde</Label>
              <Select
                value={accountFromId}
                onValueChange={setAccountFromId}
                disabled={isPending || disableAccounts}
              >
                <SelectTrigger
                  id="accountFromId"
                  aria-invalid={errors.accountFromId ? true : undefined}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} ({a.ownerTag}) ({a.currencyDefault})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.accountFromId && (
                <p className="text-sm text-destructive">{errors.accountFromId}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="accountToId">Hacia</Label>
              <Select
                value={accountToId}
                onValueChange={setAccountToId}
                disabled={isPending || disableAccounts}
              >
                <SelectTrigger
                  id="accountToId"
                  aria-invalid={errors.accountToId ? true : undefined}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} ({a.ownerTag}) ({a.currencyDefault})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.accountToId && (
                <p className="text-sm text-destructive">{errors.accountToId}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="amountFrom">Monto que sale {fromAcc && `(${fromAcc.currencyDefault})`}</Label>
              <Input
                id="amountFrom"
                name="amountFrom"
                type="number"
                step="0.01"
                min="0"
                required
                disabled={isPending}
                value={amountFrom}
                onChange={(e) => handleAmountFromChange(e.target.value)}
                placeholder="0.00"
                aria-invalid={errors.amountFrom ? true : undefined}
              />
              {errors.amountFrom && (
                <p className="text-sm text-destructive">{errors.amountFrom}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="amountTo">Monto que entra {toAcc && `(${toAcc.currencyDefault})`}</Label>
              <Input
                id="amountTo"
                name="amountTo"
                type="number"
                step="0.01"
                min="0"
                required
                disabled={isPending}
                value={amountTo}
                onChange={(e) => {
                  setAmountTo(e.target.value);
                  setAmountToTouched(true);
                }}
                placeholder="0.00"
                aria-invalid={errors.amountTo ? true : undefined}
              />
              {!sameCurrency && fromAcc && toAcc && (
                <p className="text-xs text-muted-foreground">
                  Cross-currency: cargá el monto efectivamente recibido en {toAcc.currencyDefault}.
                </p>
              )}
              {errors.amountTo && <p className="text-sm text-destructive">{errors.amountTo}</p>}
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
              placeholder="MEP venta dólares, reposición caja…"
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
