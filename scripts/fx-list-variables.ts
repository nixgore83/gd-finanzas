import { loadEnv } from './_env';
import { listBcraVariables } from '../lib/fx/bcra';

/**
 * One-shot: lista todas las variables BCRA filtrando las relacionadas con
 * tipo de cambio. Sirve para descubrir el `idVariable` del minorista
 * (Comunicación B) y del mayorista (Comunicación A 3500) sin hardcodear.
 *
 * Uso: npm run fx:list-vars
 */
async function main() {
  loadEnv();

  const all = await listBcraVariables();
  console.warn(`[fx:list-vars] BCRA devolvió ${all.length} variables totales`);

  const needle = /(tipo de cambio|d[oó]lar|usd)/i;
  const fx = all.filter((v) => needle.test(v.descripcion));

  console.warn(`[fx:list-vars] ${fx.length} relacionadas con tipo de cambio:\n`);
  for (const v of fx) {
    const cat = v.categoria ? ` [${v.categoria}]` : '';
    console.warn(`  id=${v.idVariable}${cat}  ${v.descripcion}`);
  }
}

main().catch((err: unknown) => {
  console.error('[fx:list-vars] failed:', err);
  process.exit(1);
});
