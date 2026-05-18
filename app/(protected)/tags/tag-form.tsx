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

type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; fields?: Record<string, string> };

type Props = {
  action: (formData: FormData) => Promise<ActionResult>;
  initial?: { name: string; color: string | null };
  hiddenId?: string;
  submitLabel: string;
  title: string;
  description: string;
};

const DEFAULT_COLOR = '#6b7280';

export function TagForm({ action, initial, hiddenId, submitLabel, title, description }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [hasColor, setHasColor] = useState<boolean>(initial?.color !== null && initial !== undefined);
  const [color, setColor] = useState<string>(initial?.color ?? DEFAULT_COLOR);

  function handleSubmit(formData: FormData) {
    if (hiddenId) formData.set('id', hiddenId);
    if (!hasColor) formData.set('wipeColor', '1');

    setErrors({});
    startTransition(async () => {
      const result = await action(formData);
      if (result.ok) {
        toast.success(hiddenId ? 'Etiqueta actualizada' : 'Etiqueta creada');
        router.push('/tags');
        router.refresh();
        return;
      }
      if ((result.error === 'invalid_input' || result.error === 'name_taken') && result.fields) {
        setErrors(result.fields);
        toast.error(
          result.error === 'name_taken' ? 'Nombre ya existe' : 'Revisá los campos marcados',
        );
        return;
      }
      if (result.error === 'not_found') {
        toast.error('La etiqueta no existe o no es tuya');
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
              maxLength={50}
              defaultValue={initial?.name ?? ''}
              disabled={isPending}
              placeholder="Rabbit Hole, vacaciones 2026, Pau…"
              aria-invalid={errors.name ? true : undefined}
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hasColor}
                  onChange={(e) => setHasColor(e.target.checked)}
                  disabled={isPending}
                />
                Asignar color
              </label>
              <input
                type="color"
                name="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                disabled={isPending || !hasColor}
                className="h-9 w-16 cursor-pointer rounded border border-input disabled:opacity-40"
              />
              <span className="text-xs text-muted-foreground">
                {hasColor ? color : 'sin color'}
              </span>
            </div>
            {errors.color && <p className="text-sm text-destructive">{errors.color}</p>}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" asChild disabled={isPending}>
              <Link href="/tags">Cancelar</Link>
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
