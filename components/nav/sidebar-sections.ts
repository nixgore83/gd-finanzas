export type SidebarLink = {
  href: string;
  label: string;
  /** Si está, el link queda activo cuando el pathname empieza por este prefix. */
  matchPrefix?: string;
};

export type SidebarSection = {
  key: string;
  title: string;
  links: SidebarLink[];
};

export const SIDEBAR_SECTIONS: SidebarSection[] = [
  {
    key: 'operar',
    title: 'Operar',
    links: [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/accounts', label: 'Cuentas', matchPrefix: '/accounts' },
      { href: '/transactions', label: 'Transacciones', matchPrefix: '/transactions' },
      { href: '/tags', label: 'Etiquetas', matchPrefix: '/tags' },
    ],
  },
  {
    key: 'planificar',
    title: 'Planificar',
    links: [
      { href: '/recurrences', label: 'Recurrencias', matchPrefix: '/recurrences' },
      { href: '/forecasts', label: 'Previsiones' },
      { href: '/budget', label: 'Presupuesto', matchPrefix: '/budget' },
    ],
  },
  {
    key: 'reportes',
    title: 'Reportes',
    links: [
      { href: '/reports/cashflow', label: 'Cashflow' },
      { href: '/reports/breakdown', label: 'Breakdown' },
      { href: '/reports/evolution', label: 'Evolución' },
      { href: '/reports/year-economy', label: 'Año económico' },
    ],
  },
  {
    key: 'tools',
    title: 'Tools',
    links: [
      { href: '/imports', label: 'Imports', matchPrefix: '/imports' },
      { href: '/exports', label: 'Exports' },
    ],
  },
  {
    key: 'settings',
    title: 'Settings',
    links: [
      { href: '/settings/metas', label: 'Metas' },
      { href: '/settings/categorias', label: 'Categorías' },
      { href: '/settings/backups', label: 'Backups' },
    ],
  },
];

export function isActiveLink(pathname: string, link: SidebarLink): boolean {
  if (link.matchPrefix) {
    return pathname === link.matchPrefix || pathname.startsWith(link.matchPrefix + '/');
  }
  return pathname === link.href;
}
