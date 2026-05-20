import Link from 'next/link';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/settings/metas', label: 'Metas', key: 'metas' as const },
  { href: '/settings/categorias', label: 'Categorías', key: 'categorias' as const },
];

export type SettingsKey = (typeof LINKS)[number]['key'];

export function SettingsNav({ active }: { active: SettingsKey }) {
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
