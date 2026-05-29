'use client';

import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Sidebar } from './sidebar';

export function MobileNav({
  userDisplayName,
  badges,
}: {
  userDisplayName: string | null;
  badges?: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);

  // Lock scroll while open
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menú"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground transition-colors hover:bg-accent md:hidden"
      >
        <Menu className="size-4" />
      </button>

      {/* Backdrop */}
      <div
        aria-hidden={!open}
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-background/70 backdrop-blur-sm transition-opacity md:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Drawer */}
      <div
        className={`fixed inset-y-0 left-0 z-50 transition-transform md:hidden ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="relative h-full">
          <Sidebar
            userDisplayName={userDisplayName}
            onNavigate={() => setOpen(false)}
            badges={badges}
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar menú"
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </>
  );
}
