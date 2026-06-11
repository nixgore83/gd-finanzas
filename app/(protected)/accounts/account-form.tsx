'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useTransition } from 'react';
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
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  CARD_BRANDS,
  CARD_BRAND_LABELS,
  CURRENCIES,
  OWNER_TAGS,
  type AccountInput,
} from '@/lib/schemas/account';

type Institution = { id: string; name: string };

type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; fields?: Record<string, string> };

type Props = {
  institutions: Institution[];
  action: (formData: FormData) => Promise<ActionResult>;
  initial?: Partial<AccountInput> & { id?: string; pdfPassword?: string | null };
  submitLabel: string;
  hiddenId?: string;
  title: string;
  description: string;
};

const NONE_VALUE = '__none__';

export function AccountForm({
  institutions,
  action,
  initial,
  submitLabel,
  hiddenId,
  title,
  description,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Estado controlado solo para los selects (necesario porque Radix Select no
  // emite name/value como input nativo). El resto va via FormData del DOM.
  const [type, setType] = useState<string>(initial?.type ?? 'bank_savings');
  const [cardBrand, setCardBrand] = useState<string>(initial?.cardBrand ?? NONE_VALUE);
  const [currencyDefault, setCurrencyDefault] = useState<string>(
    initial?.currencyDefault ?? 'ARS',
  );
  const [institutionId, setInstitutionId] = useState<string>(
    initial?.institutionId ?? NONE_VALUE,
  );
  const [ownerTag, setOwnerTag] = useState<string>(initial?.ownerTag ?? 'Hogar');

  function handleSubmit(formData: FormData) {
    // Inyectar los valores controlados de los Selects en el FormData.
    formData.set('type', type);
    // La marca solo aplica a TC; en otros tipos se manda vacío (→ null).
    formData.set(
      'cardBrand',
      type === 'credit_card' && cardBrand !== NONE_VALUE ? cardBrand : '',
    );
    formData.set('currencyDefault', currencyDefault);
    formData.set('institutionId', institutionId === NONE_VALUE ? '' : institutionId);
    formData.set('ownerTag', ownerTag);
    if (hiddenId) formData.set('id', hiddenId);

    setErrors({});
    startTransition(async () => {
      const result = await action(formData);
      if (result.ok) {
        toast.success(hiddenId ? 'Cuenta actualizada' : 'Cuenta creada');
        router.push('/accounts');
        router.refresh();
        return;
      }
      if (result.error === 'invalid_input' && result.fields) {
        setErrors(result.fields);
        toast.error('Revisá los campos marcados');
        return;
      }
      if (result.error === 'not_found') {
        toast.error('La cuenta no existe o no es tuya');
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
            <Label htmlFor="name">Rótulo (opcional)</Label>
            <Input
              id="name"
              name="name"
              maxLength={80}
              defaultValue={initial?.name ?? ''}
              disabled={isPending}
              placeholder="Solo si hace falta distinguirla — ej. Argentina"
              aria-invalid={errors.name ? true : undefined}
            />
            <p className="text-xs text-muted-foreground">
              El nombre se arma solo con institución, tipo, marca, titular y moneda. Usá el
              rótulo únicamente para una distinción extra (ej. Balanz “Argentina” vs
              “Internacional”).
            </p>
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="type">Tipo</Label>
              <Select value={type} onValueChange={setType} disabled={isPending}>
                <SelectTrigger id="type" aria-invalid={errors.type ? true : undefined}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {ACCOUNT_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.type && <p className="text-sm text-destructive">{errors.type}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="currencyDefault">Moneda</Label>
              <Select
                value={currencyDefault}
                onValueChange={setCurrencyDefault}
                disabled={isPending}
              >
                <SelectTrigger
                  id="currencyDefault"
                  aria-invalid={errors.currencyDefault ? true : undefined}
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
              {errors.currencyDefault && (
                <p className="text-sm text-destructive">{errors.currencyDefault}</p>
              )}
            </div>
          </div>

          {type === 'credit_card' && (
            <div className="space-y-2">
              <Label htmlFor="cardBrand">Marca</Label>
              <Select value={cardBrand} onValueChange={setCardBrand} disabled={isPending}>
                <SelectTrigger
                  id="cardBrand"
                  aria-invalid={errors.cardBrand ? true : undefined}
                >
                  <SelectValue placeholder="Elegí la marca" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— Sin especificar —</SelectItem>
                  {CARD_BRANDS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {CARD_BRAND_LABELS[b]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.cardBrand && (
                <p className="text-sm text-destructive">{errors.cardBrand}</p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="institutionId">Institución</Label>
            <Select
              value={institutionId}
              onValueChange={setInstitutionId}
              disabled={isPending}
            >
              <SelectTrigger
                id="institutionId"
                aria-invalid={errors.institutionId ? true : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>— Ninguna (efectivo) —</SelectItem>
                {institutions.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>
                    {inst.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.institutionId && (
              <p className="text-sm text-destructive">{errors.institutionId}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="ownerTag">Titular</Label>
            <Select value={ownerTag} onValueChange={setOwnerTag} disabled={isPending}>
              <SelectTrigger id="ownerTag" aria-invalid={errors.ownerTag ? true : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OWNER_TAGS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.ownerTag && <p className="text-sm text-destructive">{errors.ownerTag}</p>}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="expectsMonthlyImport"
              name="expectsMonthlyImport"
              defaultChecked={initial?.expectsMonthlyImport ?? false}
              disabled={isPending}
              className="size-4 rounded border-input"
            />
            <Label htmlFor="expectsMonthlyImport" className="cursor-pointer text-sm font-normal">
              Espera import mensual (alertar si falta un mes)
            </Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pdfPassword">Contraseña PDF</Label>
            <Input
              id="pdfPassword"
              name="pdfPassword"
              maxLength={100}
              defaultValue={initial?.pdfPassword ?? ''}
              disabled={isPending}
              placeholder="Opcional — para PDFs protegidos"
            />
            <p className="text-xs text-muted-foreground">
              Si el banco protege los resúmenes con contraseña, ingresala acá.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" asChild disabled={isPending}>
              <Link href="/accounts">Cancelar</Link>
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
