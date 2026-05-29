'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { parseImport } from '@/app/actions/imports/parse';

export function ParseButton({
  importId,
  isPdf,
  hasStoredPassword,
}: {
  importId: string;
  isPdf: boolean;
  hasStoredPassword: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [password, setPassword] = useState('');
  const [persistPassword, setPersistPassword] = useState(true);

  return (
    <div className="space-y-4 max-w-sm">
      {isPdf && (
        <div className="space-y-3 rounded border border-border bg-muted/20 p-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="pdf-pass">
              {hasStoredPassword
                ? 'Contraseña de desencriptación (vacío para usar la guardada):'
                : 'Contraseña de desencriptación (requerida para desbloquear el PDF):'}
            </label>
            <input
              id="pdf-pass"
              type="password"
              placeholder={hasStoredPassword ? '•••••••• (guardada)' : 'Ingresá la contraseña'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isPending}
              className="flex h-8 w-full rounded border border-input bg-background px-3 py-1 text-xs shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={persistPassword}
              onChange={(e) => setPersistPassword(e.target.checked)}
              disabled={isPending || !password}
              className="size-4 rounded border-input"
            />
            <span>Guardar contraseña para futuras importaciones</span>
          </label>
        </div>
      )}
      <Button
        onClick={() => {
          startTransition(async () => {
            const res = await parseImport(importId, password || undefined, persistPassword);
            if (res.ok) {
              toast.success(`Parser OK · ${res.lineCount} líneas`);
              router.refresh();
            } else {
              toast.error('message' in res && res.message ? res.message : `Error: ${res.error}`);
              router.refresh();
            }
          });
        }}
        disabled={isPending}
      >
        {isPending ? 'Parseando…' : 'Parsear con LLM'}
      </Button>
    </div>
  );
}
