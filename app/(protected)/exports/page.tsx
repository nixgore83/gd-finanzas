import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { ExportsClient } from './exports-client';

export const metadata = {
  title: 'Exports · gd-finanzas',
};

export default async function ExportsPage() {
  try {
    await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Exports</h1>
        <p className="text-sm text-muted-foreground">
          Genera archivos para llevar al contador al cierre del año fiscal.
        </p>
      </div>

      <section className="space-y-3 rounded-md border bg-card p-4">
        <div>
          <h2 className="text-base font-semibold">Ganancias · resumen anual</h2>
          <p className="text-sm text-muted-foreground">
            Descarga un{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">.zip</code> con 5 CSVs
            (ingresos, consumos TC, servicio doméstico, gastos deducibles, otros ingresos)
            + un README. Formato UTF-8 con BOM (compatible con Excel).
          </p>
        </div>

        <ExportsClient years={years} defaultYear={currentYear} />

        <div className="mt-2 rounded-md bg-amber-50 border border-amber-300 p-3 text-xs text-amber-900">
          <p className="font-medium">Alcance</p>
          <p>
            Este export cubre aproximadamente el 30% del checklist de Ganancias — la parte
            de movimientos transaccionales del año. NO incluye items patrimoniales (saldos
            al 31/12, inmuebles, rodados, tenencias). Esos van aparte (V2 los va a
            cubrir).
          </p>
        </div>
      </section>
    </div>
  );
}
