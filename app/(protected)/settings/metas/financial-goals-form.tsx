'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Decimal from 'decimal.js';
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

export function FinancialGoalsForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Estado para los 3 montos del total target (calculado en vivo)
  const [retiro, setRetiro] = useState<string>(initial.numeroRetiroUsd);
  const [educacion, setEducacion] = useState<string>(initial.numeroEducacionUsd);
  const [buffer, setBuffer] = useState<string>(initial.bufferUsd);

  const totalTarget = useMemo(() => {
    try {
      return new Decimal(retiro || 0)
        .plus(educacion || 0)
        .plus(buffer || 0)
        .toFixed(0);
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
    <Card>
      <CardHeader>
        <CardTitle>Plan financiero</CardTitle>
        <CardDescription>
          Editable. Alimenta el bloque “Trayectoria a IF” del reporte D.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="targetAhorroMensualUsd">Target ahorro mensual (USD)</Label>
            <Input
              id="targetAhorroMensualUsd"
              name="targetAhorroMensualUsd"
              type="number"
              step="1"
              min="0"
              required
              defaultValue={initial.targetAhorroMensualUsd}
              disabled={isPending}
              aria-invalid={errors.targetAhorroMensualUsd ? true : undefined}
            />
            {errors.targetAhorroMensualUsd && (
              <p className="text-sm text-destructive">{errors.targetAhorroMensualUsd}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="edadTargetIfNico">Edad target IF — Nico</Label>
              <Input
                id="edadTargetIfNico"
                name="edadTargetIfNico"
                type="number"
                min="18"
                max="120"
                required
                defaultValue={initial.edadTargetIfNico}
                disabled={isPending}
                aria-invalid={errors.edadTargetIfNico ? true : undefined}
              />
              {errors.edadTargetIfNico && (
                <p className="text-sm text-destructive">{errors.edadTargetIfNico}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="edadTargetIfPau">Edad target IF — Pau</Label>
              <Input
                id="edadTargetIfPau"
                name="edadTargetIfPau"
                type="number"
                min="18"
                max="120"
                required
                defaultValue={initial.edadTargetIfPau}
                disabled={isPending}
                aria-invalid={errors.edadTargetIfPau ? true : undefined}
              />
              {errors.edadTargetIfPau && (
                <p className="text-sm text-destructive">{errors.edadTargetIfPau}</p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Componentes del número target (USD)</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="numeroRetiroUsd">Retiro</Label>
                <Input
                  id="numeroRetiroUsd"
                  name="numeroRetiroUsd"
                  type="number"
                  step="1"
                  min="0"
                  required
                  value={retiro}
                  onChange={(e) => setRetiro(e.target.value)}
                  disabled={isPending}
                  aria-invalid={errors.numeroRetiroUsd ? true : undefined}
                />
                {errors.numeroRetiroUsd && (
                  <p className="text-sm text-destructive">{errors.numeroRetiroUsd}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="numeroEducacionUsd">Educación</Label>
                <Input
                  id="numeroEducacionUsd"
                  name="numeroEducacionUsd"
                  type="number"
                  step="1"
                  min="0"
                  required
                  value={educacion}
                  onChange={(e) => setEducacion(e.target.value)}
                  disabled={isPending}
                  aria-invalid={errors.numeroEducacionUsd ? true : undefined}
                />
                {errors.numeroEducacionUsd && (
                  <p className="text-sm text-destructive">{errors.numeroEducacionUsd}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="bufferUsd">Buffer</Label>
                <Input
                  id="bufferUsd"
                  name="bufferUsd"
                  type="number"
                  step="1"
                  min="0"
                  required
                  value={buffer}
                  onChange={(e) => setBuffer(e.target.value)}
                  disabled={isPending}
                  aria-invalid={errors.bufferUsd ? true : undefined}
                />
                {errors.bufferUsd && (
                  <p className="text-sm text-destructive">{errors.bufferUsd}</p>
                )}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Total target ={' '}
              <span className="font-medium tabular-nums text-foreground">
                {formatUsd(totalTarget)}
              </span>{' '}
              (calculado, no se guarda)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notas">Notas (opcional)</Label>
            <textarea
              id="notas"
              name="notas"
              rows={4}
              maxLength={2000}
              defaultValue={initial.notas ?? ''}
              disabled={isPending}
              placeholder="Supuestos del plan, próxima review, etc."
              className={cn(
                'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
              )}
              aria-invalid={errors.notas ? true : undefined}
            />
            {errors.notas && <p className="text-sm text-destructive">{errors.notas}</p>}
          </div>

          <div className="flex items-center justify-between gap-2 pt-2">
            <p className="text-xs text-muted-foreground">
              {initial.updatedAt
                ? `Última actualización: ${initial.updatedAt}${
                    initial.updatedByEmail ? ` por ${initial.updatedByEmail}` : ''
                  }`
                : 'Primera vez: prellenado con defaults del PRD (validados con Pau 2026-05-05).'}
            </p>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
