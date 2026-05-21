'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useSyncExternalStore } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import {
  SIDEBAR_SECTIONS,
  isActiveLink,
  type SidebarLink,
  type SidebarSection,
} from './sidebar-sections';

const STORAGE_KEY = 'gd-sidebar-open';
const EVENT = 'gd-sidebar-change';

function subscribe(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}
function getSnapshot(): string {
  return localStorage.getItem(STORAGE_KEY) ?? '';
}
function getServerSnapshot(): string {
  return '';
}
function setStoredOpen(set: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  window.dispatchEvent(new Event(EVENT));
}

function parseStored(raw: string): Set<string> | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr))
      return new Set(arr.filter((s): s is string => typeof s === 'string'));
  } catch {
    /* ignore */
  }
  return null;
}

function findActiveSection(pathname: string): string | null {
  for (const section of SIDEBAR_SECTIONS) {
    for (const link of section.links) {
      if (isActiveLink(pathname, link)) return section.key;
    }
  }
  return null;
}

type Props = {
  userDisplayName: string | null;
  onNavigate?: () => void;
};

export function Sidebar({ userDisplayName, onNavigate }: Props) {
  const pathname = usePathname();
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const activeSection = useMemo(() => findActiveSection(pathname), [pathname]);

  const openSet = useMemo(() => {
    const storedSet = parseStored(stored);
    if (storedSet) {
      if (activeSection) storedSet.add(activeSection);
      return storedSet;
    }
    // Default: solo la sección que contiene la ruta activa.
    return new Set<string>(activeSection ? [activeSection] : []);
  }, [stored, activeSection]);

  function toggleSection(key: string) {
    const next = new Set(openSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setStoredOpen(next);
  }

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
          <SectionBlock
            key={section.key}
            section={section}
            isOpen={openSet.has(section.key)}
            onToggle={() => toggleSection(section.key)}
            pathname={pathname}
            onNavigate={onNavigate}
          />
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

function SectionBlock({
  section,
  isOpen,
  onToggle,
  pathname,
  onNavigate,
}: {
  section: SidebarSection;
  isOpen: boolean;
  onToggle: () => void;
  pathname: string;
  onNavigate?: () => void;
}) {
  const hasActive = section.links.some((l) => isActiveLink(pathname, l));
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className={cn(
          'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-widest transition-colors',
          hasActive
            ? 'text-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <span>{section.title}</span>
        <ChevronDown
          className={cn(
            'size-3.5 transition-transform',
            isOpen ? 'rotate-0' : '-rotate-90',
          )}
        />
      </button>
      {isOpen && (
        <ul className="mt-1 space-y-0.5 pl-1">
          {section.links.map((link) => (
            <li key={link.href}>
              <NavLink link={link} pathname={pathname} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      )}
    </div>
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
