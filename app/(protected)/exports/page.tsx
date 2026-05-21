import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { Display, Label, Num, Hair, Body } from '@/components/ui/typography';
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
    <div className="space-y-8">
      <header className="pt-2">
        <Label>Tools · Exports</Label>
        <Display size="lg" className="mt-2 block">
          Exports
        </Display>
        <Body className="mt-2 max-w-2xl">
          Paquetes preformateados para llevar al contador al cierre del año fiscal.
        </Body>
      </header>

      <Hair thick />

      {/* Main card */}
      <section className="border border-border bg-card/40 p-8">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[1.4fr_280px]">
          <div>
            <Label>Pack contable · Ganancias</Label>
            <Display size="md" className="mt-3 block">
              Ganancias · resumen anual
            </Display>
            <Body className="mt-3 max-w-prose">
              ZIP con 5 archivos CSV preformateados:{' '}
              <span className="text-foreground">ingresos</span>,{' '}
              <span className="text-foreground">consumos TC</span>,{' '}
              <span className="text-foreground">servicio doméstico</span>,{' '}
              <span className="text-foreground">gastos deducibles</span> y{' '}
              <span className="text-foreground">otros ingresos</span>, más un README con
              disclaimer y procedencia. UTF-8 con BOM (compatible Excel). No se persiste —
              se genera al momento.
            </Body>

            {/* File list */}
            <div className="mt-6 grid grid-cols-1 gap-y-2 sm:grid-cols-2 sm:gap-x-6">
              {[
                ['01_ingresos.csv', 'sueldos + freelance'],
                ['02_consumos_tc.csv', 'agrupado por TC y mes'],
                ['03_servicio_domestico.csv', 'con CUIL + concepto'],
                ['04_gastos_deducibles.csv', 'flag deducible=true'],
                ['05_otros_ingresos.csv', 'income sin sueldo'],
                ['readme.md', 'disclaimer + alcance'],
              ].map(([f, hint]) => (
                <div
                  key={f}
                  className="flex items-baseline justify-between gap-3 border-b border-border/40 py-2"
                >
                  <Num className="text-xs text-foreground">{f}</Num>
                  <span className="font-display text-xs text-muted-foreground">{hint}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <ExportsClient years={years} defaultYear={currentYear} />
            <Body className="mt-4 text-xs">
              Se genera ahora — no se guarda en el server. Pesa entre 80&nbsp;KB y 400&nbsp;KB
              según el año.
            </Body>
          </div>
        </div>
      </section>

      {/* Disclaimer */}
      <div
        className="border-l-2 border-[color:var(--attn)] px-5 py-4"
        style={{ background: 'color-mix(in oklab, var(--attn) 8%, transparent)' }}
      >
        <Label style={{ color: 'var(--attn)' }}>Alcance · PRD § 5.7</Label>
        <Body className="mt-2 max-w-3xl">
          Este export cubre <span className="text-foreground">~30 %</span> del checklist de
          Ganancias — la parte transaccional del año. <span className="text-foreground">NO</span>{' '}
          incluye items patrimoniales (saldos al 31/12, inmuebles, rodados, tenencias). Esos van
          aparte (V2).
        </Body>
      </div>
    </div>
  );
}
