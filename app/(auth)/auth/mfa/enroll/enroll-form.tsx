'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { verifyMfaCode } from '@/app/actions/auth/mfa/verify';
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

type Props = {
  factorId: string;
  qrCode: string;
  secret: string;
};

export function EnrollForm({ factorId, qrCode, secret }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showSecret, setShowSecret] = useState(false);

  function handleSubmit(formData: FormData) {
    formData.set('factorId', factorId);
    startTransition(async () => {
      const result = await verifyMfaCode(formData);
      if (result.ok) {
        toast.success('2FA activado');
        router.replace('/dashboard');
        router.refresh();
        return;
      }
      if (result.error === 'invalid_input') toast.error('Código inválido');
      else if (result.error === 'invalid_code') toast.error('Código incorrecto');
      else toast.error('No pudimos verificar. Probá de nuevo.');
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activar 2FA</CardTitle>
        <CardDescription>
          Escaneá el QR con tu app de autenticación (Google Authenticator, 1Password, etc.) y
          escribí el código de 6 dígitos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-center rounded-md border bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrCode} alt="Código QR para 2FA" className="h-44 w-44" />
        </div>

        <button
          type="button"
          onClick={() => setShowSecret((v) => !v)}
          className="text-xs underline underline-offset-4 text-muted-foreground hover:opacity-80"
        >
          {showSecret ? 'Ocultar código manual' : '¿No podés escanear? Ver código manual'}
        </button>
        {showSecret && (
          <code className="block break-all rounded bg-muted px-2 py-1 text-xs">{secret}</code>
        )}

        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">Código</Label>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              disabled={isPending}
              placeholder="123456"
            />
          </div>
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? 'Verificando…' : 'Activar'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
