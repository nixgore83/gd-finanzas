import Link from 'next/link';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/reports/cashflow', label: 'Cashflow', key: 'cashflow' as const },
  { href: '/reports/breakdown', label: 'Breakdown', key: 'breakdown' as const },
  { href: '/reports/evolution', label: 'Evolución', key: 'evolution' as const },
  { href: '/reports/year-economy', label: 'Año económico', key: 'year-economy' as const },
];

export type ReportKey = (typeof LINKS)[number]['key'];

/**
 * Nav interna de reportes. Cuatro tabs con border-bottom sage cuando activa.
 * Mismo treatment que los FilterPill que usamos en /accounts y /recurrences.
 */
export function ReportsNav({ active }: { active: ReportKey }) {
  return (
    <nav className="border-border/60 flex items-baseline gap-1 border-b" aria-label="Reportes">
      {LINKS.map((link) => {
        const isActive = active === link.key;
        return (
          <Link
            key={link.key}
            href={link.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-block px-3 py-2.5 font-sans text-[11px] font-semibold tracking-[0.18em] uppercase transition-colors',
              isActive
                ? 'border-primary text-primary -mb-px border-b-2'
                : 'text-muted-foreground hover:text-foreground border-b-2 border-transparent',
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
