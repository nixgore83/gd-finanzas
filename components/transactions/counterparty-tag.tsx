import { cn } from '@/lib/utils';
import type { Counterparty } from '@/lib/imports/parsers/types';

/**
 * Muestra la contraparte (ordenante/beneficiario) de una transacción/línea de
 * import: etiqueta amigable en primer plano + nombre crudo + identificadores.
 * Presentacional puro — sirve en server y client components.
 */
export function CounterpartyTag({
  counterparty,
  className,
}: {
  counterparty?: Counterparty | null;
  className?: string;
}) {
  if (!counterparty) return null;
  const { name, accountRef, cuil, cbu, alias, label } = counterparty;
  const ids = [
    accountRef && `cta ${accountRef}`,
    cuil && `CUIL ${cuil}`,
    cbu && `CBU ${cbu}`,
    alias && `alias ${alias}`,
  ].filter(Boolean);
  if (!name && !label && ids.length === 0) return null;
  return (
    <div className={cn('text-[10px] leading-tight text-muted-foreground', className)}>
      {label && <span className="font-semibold text-foreground">{label}</span>}
      {name && <span className={cn('font-medium', label && 'ml-1')}>{name}</span>}
      {ids.length > 0 && <span className="block font-mono">{ids.join(' · ')}</span>}
    </div>
  );
}
