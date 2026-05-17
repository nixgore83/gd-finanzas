import { loadEnv } from './_env';

/**
 * Smoke manual del helper `getFxRate`. Llama el helper con 3 casos:
 *   - USD un día hábil con cotización → devuelve la del día.
 *   - USD un domingo → fallback al viernes/sábado previo, source BCRA_last_available.
 *   - ARS cualquier día → atajo identity, rate=1.
 *
 * Uso: npm run fx:smoke
 */

async function main() {
  loadEnv();
  const { getFxRate } = await import('../lib/fx/get-fx-rate');

  const cases = [
    { date: '2026-05-15', currency: 'USD' as const, label: 'viernes con cotización' },
    { date: '2026-05-17', currency: 'USD' as const, label: 'domingo → fallback al viernes' },
    { date: '2026-05-15', currency: 'ARS' as const, label: 'ARS → identity rate=1' },
  ];

  for (const c of cases) {
    try {
      const r = await getFxRate({ date: c.date, currency: c.currency });
      console.warn(
        `[fx:smoke] ${c.label}: rate=${r.rate.toFixed(4)} source=${r.source} effective=${r.effectiveDate}`,
      );
    } catch (err) {
      console.error(`[fx:smoke] ${c.label} → error:`, err);
    }
  }
}

main().catch((err: unknown) => {
  console.error('[fx:smoke] failed:', err);
  process.exit(1);
});
