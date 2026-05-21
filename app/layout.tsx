import type { Metadata } from 'next';
import { Cormorant_Garamond, Manrope, JetBrains_Mono } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

/**
 * Display serif — Cormorant Garamond.
 * Vault Sage usa light/regular para titulares y números prominentes.
 * Italics están disponibles para "el toque editorial".
 */
const displayFont = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

/**
 * Body grotesk — Manrope.
 * Para UI chrome, labels, párrafos, botones.
 */
const sansFont = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

/**
 * Tabular numeric — JetBrains Mono.
 * Solo para montos, fechas y cualquier columna numérica que se compara.
 */
const monoFont = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'gd-finanzas',
  description: 'Tracking financiero familiar — Garaglio-Dasso',
};

// Script anti-flash: corre antes del hydrate y aplica la class `dark` según
// localStorage o prefers-color-scheme del OS.
const themeScript = `(function(){try{var t=localStorage.getItem('gd-theme');var d=(t==='dark')||((t==='system'||!t)&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="es"
      className={`h-full antialiased ${displayFont.variable} ${sansFont.variable} ${monoFont.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full font-sans">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
