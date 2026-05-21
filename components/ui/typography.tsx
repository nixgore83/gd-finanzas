import { cn } from '@/lib/utils';
import type { ComponentPropsWithoutRef } from 'react';

/**
 * Primitives tipográficos de Vault Sage.
 *
 * Encapsulan los patterns que se repiten en toda la app:
 * - <Display>   titulares y números prominentes (Cormorant serif, light)
 * - <Label>     section labels uppercase tracked (Manrope, semibold)
 * - <Num>       montos / tabular nums (JetBrains Mono)
 * - <Hair>      separador delgado horizontal (1px border)
 *
 * Usalas en lugar de re-implementar font-display tracking-tight text-5xl etc
 * cada vez. Si un caso particular necesita variar, pasale className.
 */

type SpanProps = ComponentPropsWithoutRef<'span'>;
type DivProps = ComponentPropsWithoutRef<'div'>;

const DISPLAY_SIZES = {
  sm: 'text-xl leading-[1.1]',
  md: 'text-3xl leading-[1.05]',
  lg: 'text-5xl leading-[1.02] tracking-[-0.015em]',
  xl: 'text-7xl leading-[0.98] tracking-[-0.02em]',
} as const;

type DisplaySize = keyof typeof DISPLAY_SIZES;

/**
 * Titulares de página, números hero, números prominentes.
 * Por default `md`. `xl` para los heros tipo "15 años hasta la libertad".
 *
 * Renderiza como <span> para componer inline ("US$ {value}") sin romper flow.
 * Si necesitás block, envolvélo o pasale className="block".
 */
export function Display({
  size = 'md',
  className,
  ...props
}: SpanProps & { size?: DisplaySize }) {
  return (
    <span
      className={cn(
        'font-display font-light text-foreground',
        DISPLAY_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

/**
 * Section labels y micro-headings. Uppercase + tracked + mono-ish weight.
 * Ej: "Reportes · Año económico", "Próximos compromisos", "MTD".
 */
export function Label({ className, ...props }: DivProps) {
  return (
    <div
      className={cn(
        'font-sans text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Montos, fechas tabulares, IDs, hashes. Mono + tabular numeric variant.
 * Por default hereda el color del padre — pasale className="text-foreground"
 * / "text-muted-foreground" / "text-primary" según el contexto.
 */
export function Num({ className, ...props }: SpanProps) {
  return (
    <span
      className={cn('font-mono tabular-nums', className)}
      {...props}
    />
  );
}

/**
 * Separador horizontal de 1px (border-color). Sirve tanto bajo secciones
 * como dentro de cards. `thick` para hits visuales fuertes (sección nueva).
 */
export function Hair({
  thick = false,
  className,
}: {
  thick?: boolean;
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      className={cn('w-full bg-border', thick ? 'h-[2px]' : 'h-px', className)}
    />
  );
}

/**
 * Cuerpos editoriales largos (intros, notas, párrafos en la página de
 * Año económico, Settings). Serif con leading cómodo + italic-friendly.
 */
export function Body({ className, ...props }: DivProps) {
  return (
    <div
      className={cn(
        'font-display text-base italic leading-[1.55] text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
