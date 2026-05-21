'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Decimal from 'decimal.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label as FormLabel } from '@/components/ui/label';
import { Display, Label, Num, Hair, Body } from '@/components/ui/typography';
import { upsertFinancialGoals } from '@/app/actions/financial-goals/upsert';
import { cn } from '@/lib/utils';

type ActionResult =
  | { ok: true }
  | { ok: false; error: string; fields?: Record<string, string> };

type Initial = {
  targetAhorroMensualUsd: string;
  edadTargetIfNico: number;
  edadTargetIfPau: number;
  numeroRetiroUsd: string;
  numeroEducacionUsd: string;
  bufferUsd: string;
  notas: string | null;
  updatedAt: string | null;
  updatedByEmail: string | null;
};

function formatUsd(amount: string | number): string {
  const n = typeof amount === 'string' ? Number.parseFloat(amount) : amount;
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatTimestamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-AR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function FinancialGoalsForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [retiro, setRetiro] = useState<string>(initial.numeroRetiroUsd);
  const [educacion, setEducacion] = useState<string>(initial.numeroEducacionUsd);
  const [buffer, setBuffer] = useState<string>(initial.bufferUsd);
  const [target, setTarget] = useState<string>(initial.targetAhorroMensualUsd);
  const [edadNico, setEdadNico] = useState<number>(initial.edadTargetIfNico);
  const [edadPau, setEdadPau] = useState<number>(initial.edadTargetIfPau);

  const totalTarget = useMemo(() => {
    try {
      return new Decimal(retiro || 0).plus(educacion || 0).plus(buffer || 0).toFixed(0);
    } catch {
      return '0';
    }
  }, [retiro, educacion, buffer]);

  function handleSubmit(formData: FormData) {
    setErrors({});
    startTransition(async () => {
      const result: ActionResult = await upsertFinancialGoals(formData);
      if (result.ok) {
        toast.success('Metas guardadas');
        router.refresh();
        return;
      }
      if (result.error === 'invalid_input' && result.fields) {
        setErrors(result.fields);
        toast.error('Revisá los campos marcados');
        return;
      }
      toast.error('No pudimos guardar. Probá de nuevo.');
    });
  }

  return (
    <form action={handleSubmit} className="space-y-10">
      {/* ============ TARGET SUMMARY STRIP ============ */}
      <section>
        <Label>Resumen del plan</Label>
        <div className="mt-3 grid grid-cols-2 gap-px bg-border md:grid-cols-4">
          <SummaryCard label="Target total" value={formatUsd(totalTarget)} variant="attn" />
          <SummaryCard
            label="Ahorro mensual"
            value={formatUsd(target || 0)}
            variant="primary"
          />
          <SummaryCard
            label="Edad IF"
            value={`${edadNico || '—'} / ${edadPau || '—'}`}
          />
          <SummaryCard
            label="Años a la IF"
            value={(() => {
              const yrsToIf = Math.max(0, (edadNico || 0) - 43); // baseline placeholder
              return yrsToIf > 0 ? `${yrsToIf} años` : '—';
            })()}
            variant="primary"
          />
        </div>
      </section>

      {/* ============ TWO COLUMNS ============ */}
      <section className="grid grid-cols-1 gap-12 lg:grid-cols-2">
        {/* LEFT: Composición */}
        <div>
          <Display size="sm">Composición del target</Display>
          <Hair className="mt-3 mb-1" />
          <FieldRow
            label="Retiro · número clave"
            id="numeroRetiroUsd"
            value={retiro}
            onChange={setRetiro}
            unit="USD"
            error={errors.numeroRetiroUsd}
            disabled={isPending}
            required
          />
          <FieldRow
            label="Educación · 3 hijos AR"
            id="numeroEducacionUsd"
            value={educacion}
            onChange={setEducacion}
            unit="USD"
            error={errors.numeroEducacionUsd}
            disabled={isPending}
            required
          />
          <FieldRow
            label="Buffer · 6 meses gastos"
            id="bufferUsd"
            value={buffer}
            onChange={setBuffer}
            unit="USD"
            error={errors.bufferUsd}
            disabled={isPending}
            required
          />
          {/* Sum row */}
          <div className="grid grid-cols-[1fr_220px] items-baseline gap-4 border-t-2 border-border py-3.5">
            <span className="font-display text-lg italic text-[color:var(--attn)]">Suma</span>
            <div className="flex items-baseline justify-end gap-3">
              <Num className="text-2xl font-semibold text-[color:var(--attn)]">
                {formatUsd(totalTarget)}
              </Num>
              <Label className="text-[color:var(--attn)]">USD</Label>
            </div>
          </div>
        </div>

        {/* RIGHT: Plan operativo */}
        <div>
          <Display size="sm">Plan operativo</Display>
          <Hair className="mt-3 mb-1" />
          <FieldRow
            label="Ahorro mensual objetivo"
            id="targetAhorroMensualUsd"
            value={target}
            onChange={setTarget}
            unit="USD"
            error={errors.targetAhorroMensualUsd}
            disabled={isPending}
            required
          />
          <FieldRow
            label="Edad target IF · Nico"
            id="edadTargetIfNico"
            value={String(edadNico)}
            onChange={(v) => setEdadNico(Number.parseInt(v, 10) || 0)}
            unit="años"
            error={errors.edadTargetIfNico}
            disabled={isPending}
            type="number"
            min={18}
            max={120}
            step={1}
            required
          />
          <FieldRow
            label="Edad target IF · Pau"
            id="edadTargetIfPau"
            value={String(edadPau)}
            onChange={(v) => setEdadPau(Number.parseInt(v, 10) || 0)}
            unit="años"
            error={errors.edadTargetIfPau}
            disabled={isPending}
            type="number"
            min={18}
            max={120}
            step={1}
            required
          />

          <div className="mt-6">
            <Label>Notas</Label>
            <textarea
              id="notas"
              name="notas"
              rows={5}
              maxLength={2000}
              defaultValue={initial.notas ?? ''}
              disabled={isPending}
              placeholder="Supuestos del plan, próxima review, recordatorios…"
              className={cn(
                'mt-2 flex w-full border border-input bg-background px-3 py-2.5 font-display text-base italic leading-relaxed text-foreground',
                'placeholder:not-italic placeholder:font-sans placeholder:text-sm placeholder:text-muted-foreground',
                'focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/40',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
              aria-invalid={errors.notas ? true : undefined}
            />
            {errors.notas && (
              <p className="mt-1 font-sans text-xs text-[color:var(--bad)]">{errors.notas}</p>
            )}
          </div>
        </div>
      </section>

      <Hair thick />

      {/* ============ FOOTER ============ */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Body>
          {initial.updatedAt ? (
            <>
              Última edición:{' '}
              {initial.updatedByEmail && (
                <span className="not-italic text-foreground">{initial.updatedByEmail}</span>
              )}{' '}
              <span className="font-mono not-italic text-muted-foreground">
                · {formatTimestamp(initial.updatedAt)}
              </span>
            </>
          ) : (
            <>Primera vez: prellenado con defaults validados con Pau el 5 may 2026.</>
          )}
        </Body>
        <Button type="submit" size="lg" disabled={isPending}>
          {isPending ? 'Guardando…' : 'Guardar metas'}
        </Button>
      </div>
    </form>
  );
}

function FieldRow({
  label,
  id,
  value,
  onChange,
  unit,
  error,
  disabled,
  required,
  type = 'number',
  min = 0,
  step = 1,
  max,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  unit: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  type?: 'number' | 'text';
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="grid grid-cols-[1fr_220px] items-baseline gap-4 border-t border-border/40 py-3.5">
      <FormLabel htmlFor={id} className="font-display text-base font-normal text-foreground">
        {label}
      </FormLabel>
      <div>
        <div className="flex items-center gap-2">
          <Input
            id={id}
            name={id}
            type={type}
            inputMode={type === 'number' ? 'numeric' : undefined}
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            required={required}
            aria-invalid={error ? true : undefined}
            className="text-right font-mono tabular-nums"
          />
          <Label className="min-w-[42px] text-right normal-case tracking-[0.18em]">{unit}</Label>
        </div>
        {error && (
          <p className="mt-1 text-right font-sans text-xs text-[color:var(--bad)]">{error}</p>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  variant = 'foreground',
}: {
  label: string;
  value: string;
  variant?: 'foreground' | 'primary' | 'attn';
}) {
  const colorVar =
    variant === 'primary'
      ? 'var(--primary)'
      : variant === 'attn'
        ? 'var(--attn)'
        : 'var(--foreground)';
  return (
    <div className="bg-card p-5">
      <Label>{label}</Label>
      <Display size="md" className="mt-3 block tabular-nums" style={{ color: colorVar }}>
        {value}
      </Display>
    </div>
  );
}
