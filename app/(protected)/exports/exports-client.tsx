'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="year">Año fiscal</Label>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger id="year" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button asChild>
        <a href={href} download>
          Descargar Ganancias {year}
        </a>
      </Button>
    </div>
  );
}
