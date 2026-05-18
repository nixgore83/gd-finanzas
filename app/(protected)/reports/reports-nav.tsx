import Link from 'next/link';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/reports/cashflow', label: 'Cashflow', key: 'cashflow' as const },
  { href: '/reports/breakdown', label: 'Breakdown', key: 'breakdown' as const },
  { href: '/reports/evolution', label: 'Evolución', key: 'evolution' as const },
];

export type ReportKey = (typeof LINKS)[number]['key'];

export function ReportsNav({ active }: { active: ReportKey }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      {LINKS.map((link, i) => (
        <span key={link.key} className="flex items-center gap-3">
          {i > 0 && <span className="text-muted-foreground">·</span>}
          <Link
            href={link.href}
            className={cn(
              active === link.key
                ? 'font-medium text-foreground'
                : 'text-muted-foreground hover:underline',
            )}
          >
            {link.label}
          </Link>
        </span>
      ))}
    </div>
  );
}
