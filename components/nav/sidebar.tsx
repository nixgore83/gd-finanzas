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
    if (Array.isArray(arr)) return new Set(arr.filter((s): s is string => typeof s === 'string'));
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
  /** Conteos a mostrar como badge, indexados por href del link (ej. `/pendientes`). */
  badges?: Record<string, number>;
};

export function Sidebar({ userDisplayName, onNavigate, badges }: Props) {
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
    <aside className="border-border bg-sidebar text-sidebar-foreground flex h-full w-60 shrink-0 flex-col border-r">
      {/* Brand header */}
      <div className="px-5 pt-7 pb-5">
        <Link href="/dashboard" onClick={onNavigate} className="inline-block transition-colors">
          <div className="font-display text-foreground text-[28px] leading-none font-light tracking-tight">
            G<span className="text-primary">·</span>D
          </div>
          <div className="text-muted-foreground mt-1.5 font-sans text-[9px] font-semibold tracking-[0.32em] uppercase">
            Privatbanken
          </div>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {SIDEBAR_SECTIONS.map((section) => (
          <SectionBlock
            key={section.key}
            section={section}
            isOpen={openSet.has(section.key)}
            onToggle={() => toggleSection(section.key)}
            pathname={pathname}
            onNavigate={onNavigate}
            badges={badges}
          />
        ))}
      </nav>

      {/* Footer: user + theme + signout */}
      <div className="border-border/60 border-t px-4 py-4">
        <div
          className="font-display text-foreground truncate text-[15px] italic"
          title={userDisplayName ?? ''}
        >
          {userDisplayName ?? '—'}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex gap-1.5">
            {(['ARS', 'USD'] as const).map((c) => (
              <span
                key={c}
                className="border-primary/40 text-primary rounded-full border px-2 py-[3px] font-sans text-[9px] font-semibold tracking-[0.18em] uppercase"
              >
                {c}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="border-border text-muted-foreground hover:border-primary/40 hover:bg-accent hover:text-foreground inline-flex h-8 items-center rounded-md border px-2.5 font-sans text-[10px] font-semibold tracking-[0.14em] uppercase transition-colors"
                title="Cerrar sesión"
              >
                Salir
              </button>
            </form>
          </div>
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
  badges,
}: {
  section: SidebarSection;
  isOpen: boolean;
  onToggle: () => void;
  pathname: string;
  onNavigate?: () => void;
  badges?: Record<string, number>;
}) {
  const hasActive = section.links.some((l) => isActiveLink(pathname, l));
  return (
    <div className="mt-4 first:mt-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className={cn(
          'flex w-full items-center justify-between rounded-md px-2 py-1 text-[10px] font-semibold tracking-[0.28em] uppercase transition-colors',
          hasActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <span>{section.title}</span>
        <ChevronDown
          className={cn('size-3 transition-transform', isOpen ? 'rotate-0' : '-rotate-90')}
        />
      </button>
      {isOpen && (
        <ul className="mt-1 space-y-px">
          {section.links.map((link) => (
            <li key={link.href}>
              <NavLink
                link={link}
                pathname={pathname}
                onNavigate={onNavigate}
                badge={badges?.[link.href]}
              />
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
  badge,
}: {
  link: SidebarLink;
  pathname: string;
  onNavigate?: () => void;
  badge?: number;
}) {
  const active = isActiveLink(pathname, link);
  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        // Serif italic-friendly nav items — feels editorial, not OS-chrome.
        'group font-display flex items-center rounded-md border-l-2 py-1.5 pr-2 pl-2.5 text-[15px] leading-snug font-normal transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'text-foreground/85 hover:border-border hover:bg-accent hover:text-foreground border-transparent',
      )}
    >
      <span className="flex-1">{link.label}</span>
      {badge != null && badge > 0 && (
        <span
          aria-label={`${badge} pendientes`}
          className="ml-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-[color:var(--attn)] px-1.5 py-[1px] font-sans text-[10px] leading-none font-semibold text-[color:var(--background)] tabular-nums"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}
