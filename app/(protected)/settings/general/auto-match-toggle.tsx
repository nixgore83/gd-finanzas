'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { updateAutoMatchSetting } from '@/app/actions/settings/update-settings';

export function AutoMatchToggle({ defaultValue }: { defaultValue: boolean }) {
  const [isPending, startTransition] = useTransition();

  function handleChange(checked: boolean) {
    startTransition(async () => {
      const res = await updateAutoMatchSetting(checked);
      if (res.ok) {
        toast.success(checked ? 'Auto-match activado' : 'Auto-match desactivado');
      } else {
        toast.error('Error al guardar');
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <Switch
        id="auto-match"
        defaultChecked={defaultValue}
        onCheckedChange={handleChange}
        disabled={isPending}
      />
      <Label htmlFor="auto-match" className="cursor-pointer">
        Auto-match previsiones
      </Label>
    </div>
  );
}
