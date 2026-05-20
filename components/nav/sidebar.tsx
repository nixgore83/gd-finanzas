'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { SIDEBAR_SECTIONS, isActiveLink, type SidebarLink } from './sidebar-sections';

type Props = {
  userDisplayName: string | null;
  /** Click handler para cerrar mobile drawer al navegar. Desktop lo ignora. */
  onNavigate?: () => void;
};

export function Sidebar({ userDisplayName, onNavigate }: Props) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="border-b border-border px-4 py-4">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="text-base font-semibold tracking-tight hover:text-primary"
        >
          gd-finanzas
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {SIDEBAR_SECTIONS.map((section) => (
          <div key={section.key} className="mb-4">
            <h3 className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {section.title}
            </h3>
            <ul className="space-y-0.5">
              {section.links.map((link) => (
                <li key={link.href}>
                  <NavLink link={link} pathname={pathname} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-3 text-sm">
        <span className="truncate text-muted-foreground" title={userDisplayName ?? ''}>
          {userDisplayName ?? '—'}
        </span>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Cerrar sesión"
            >
              Salir
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

function NavLink({
  link,
  pathname,
  onNavigate,
}: {
  link: SidebarLink;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = isActiveLink(pathname, link);
  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      className={cn(
        'flex rounded-md px-2 py-1.5 text-sm transition-colors',
        active
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-foreground/80 hover:bg-accent hover:text-foreground',
      )}
    >
      {link.label}
    </Link>
  );
}
