'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
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

type Props = { factorId: string };

export function ChallengeForm({ factorId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    formData.set('factorId', factorId);
    startTransition(async () => {
      const result = await verifyMfaCode(formData);
      if (result.ok) {
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
        <CardTitle>Verificar 2FA</CardTitle>
        <CardDescription>Ingresá el código de 6 dígitos de tu app de autenticación.</CardDescription>
      </CardHeader>
      <CardContent>
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
              autoFocus
              disabled={isPending}
              placeholder="123456"
            />
          </div>
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? 'Verificando…' : 'Verificar'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
