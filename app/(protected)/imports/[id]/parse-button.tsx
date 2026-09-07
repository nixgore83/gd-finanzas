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
    <div className="max-w-sm space-y-4">
      {isPdf && (
        <div className="border-border bg-muted/20 space-y-3 rounded border p-3">
          <div className="space-y-1.5">
            <label className="text-muted-foreground text-xs font-medium" htmlFor="pdf-pass">
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
              className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-8 w-full rounded border px-3 py-1 text-xs shadow-sm transition-colors focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs select-none">
            <input
              type="checkbox"
              checked={persistPassword}
              onChange={(e) => setPersistPassword(e.target.checked)}
              disabled={isPending || !password}
              className="border-input size-4 rounded"
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
              toast.success('Parseando en segundo plano… refrescá en un rato para ver las líneas');
              router.refresh();
            } else if (res.error === 'already_parsing') {
              toast.info('Ya hay un parseo en curso para este import. Esperá a que termine.');
              router.refresh();
            } else {
              toast.error(`Error: ${res.error}`);
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
