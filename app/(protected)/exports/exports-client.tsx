'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Label as TypoLabel } from '@/components/ui/typography';

/**
 * Selector de año fiscal + botón de descarga.
 * En lugar de un Select de shadcn, usamos pill-buttons — la lista de años es
 * acotada (6) y mucho más rápido de scanear visualmente.
 */
export function ExportsClient({
  years,
  defaultYear,
}: {
  years: number[];
  defaultYear: number;
}) {
  const [year, setYear] = useState<number>(defaultYear);
  const href = `/api/exports/ganancias?year=${year}`;

  return (
    <div className="space-y-5">
      <div>
        <Label htmlFor="year">
          <TypoLabel>Año fiscal</TypoLabel>
        </Label>
        <div id="year" className="mt-2 grid grid-cols-3 gap-1.5" role="radiogroup">
          {years.map((y) => {
            const active = year === y;
            return (
              <button
                key={y}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setYear(y)}
                className={
                  active
                    ? 'border border-primary bg-primary/[0.12] px-3 py-2.5 text-center font-mono text-base text-primary transition-colors'
                    : 'border border-border bg-transparent px-3 py-2.5 text-center font-mono text-base text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground'
                }
              >
                {y}
              </button>
            );
          })}
        </div>
      </div>

      <Button asChild size="lg" className="w-full">
        <a href={href} download>
          ↓ Descargar ZIP de {year}
        </a>
      </Button>
    </div>
  );
}
