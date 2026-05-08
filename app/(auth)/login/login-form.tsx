'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { sendMagicLink } from '@/app/actions/auth/send-magic-link';
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

export function LoginForm() {
  const [isPending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await sendMagicLink(formData);
      if (result.ok) {
        setSent(true);
      } else if (result.error === 'invalid_email') {
        toast.error('Email inválido');
      } else {
        toast.error('No pudimos enviar el link. Probá de nuevo en un rato.');
      }
    });
  }

  if (sent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Revisá tu mail</CardTitle>
          <CardDescription>
            Si tu email está autorizado, te enviamos un link para entrar. Puede tardar unos
            minutos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full" onClick={() => setSent(false)}>
            Usar otro email
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>gd-finanzas</CardTitle>
        <CardDescription>Ingresá con tu email para recibir un link de acceso.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={isPending}
              placeholder="vos@ejemplo.com"
            />
          </div>
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? 'Enviando…' : 'Enviarme el link'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
