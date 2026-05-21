import type { Metadata } from 'next';
import { Space_Grotesk, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

/**
 * Display / headings — Space Grotesk.
 * Geometric grotesque con carácter; weights 500-700 dan presencia
 * sin caer en el peso de un display "hero" genérico.
 */
const displayFont = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

/**
 * Body sans — Plus Jakarta Sans.
 * Más neutro y legíble que Manrope; mediumweight como default para
 * que el cuerpo del texto tenga más presencia que el muted standard.
 */
const sansFont = Plus_Jakarta_Sans({
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
