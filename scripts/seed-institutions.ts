import postgres from 'postgres';
import { loadEnv } from './_env';

/**
 * Seed idempotente de la tabla `institutions`. Hace UPSERT por `name`:
 * agregar/quitar de esta lista y re-correr el script es seguro y solo crea
 * las que faltan o actualiza country/default_currency si cambiaron.
 *
 * No borra entidades que ya no están en la lista — si querés sacarlas, hacelo
 * a mano vía SQL (validando que no estén referenciadas por accounts/imports).
 */

const INSTITUTIONS: { name: string; country: string; defaultCurrency: 'ARS' | 'USD' }[] = [
  // AR — bancos
  { name: 'Galicia', country: 'AR', defaultCurrency: 'ARS' },
  { name: 'ICBC', country: 'AR', defaultCurrency: 'ARS' },
  { name: 'BBVA', country: 'AR', defaultCurrency: 'ARS' },
  { name: 'Santander', country: 'AR', defaultCurrency: 'ARS' },
  { name: 'Macro', country: 'AR', defaultCurrency: 'ARS' },
  { name: 'BNA', country: 'AR', defaultCurrency: 'ARS' },
  // AR — e-wallets
  { name: 'Mercado Pago', country: 'AR', defaultCurrency: 'ARS' },
  { name: 'Brubank', country: 'AR', defaultCurrency: 'ARS' },
  { name: 'Naranja X', country: 'AR', defaultCurrency: 'ARS' },
  // AR — brokers
  { name: 'Balanz', country: 'AR', defaultCurrency: 'ARS' },
  { name: 'Cocos', country: 'AR', defaultCurrency: 'ARS' },
  { name: 'IOL', country: 'AR', defaultCurrency: 'ARS' },
  // US
  { name: 'HSBC US', country: 'US', defaultCurrency: 'USD' },
];

async function main() {
  loadEnv();

  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) throw new Error('DIRECT_URL must be set');

  const sql = postgres(directUrl, { max: 1 });

  try {
    let inserted = 0;
    let updated = 0;
    for (const inst of INSTITUTIONS) {
      const result = await sql<{ action: 'inserted' | 'updated' | 'noop' }[]>`
        insert into public.institutions (name, country, default_currency)
        values (${inst.name}, ${inst.country}, ${inst.defaultCurrency})
        on conflict (name) do update
          set country = excluded.country,
              default_currency = excluded.default_currency
          where institutions.country <> excluded.country
             or institutions.default_currency <> excluded.default_currency
        returning case
          when xmax = 0 then 'inserted'
          else 'updated'
        end as action
      `;
      if (result.length === 0) {
        // noop: row exists and no changes needed
      } else if (result[0]?.action === 'inserted') {
        inserted++;
      } else {
        updated++;
      }
    }

    console.warn(
      `[seed-institutions] ${INSTITUTIONS.length} total — ${inserted} insertadas, ${updated} actualizadas, ${INSTITUTIONS.length - inserted - updated} sin cambios`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('[seed-institutions] failed:', err);
  process.exit(1);
});
