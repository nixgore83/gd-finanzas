import postgres from 'postgres';
import { loadEnv } from './_env';

/**
 * Seed de las cuentas reales del household (cerrado con Nico, 2026-05-23).
 * Idempotente: skipea si ya existe (household_id, name).
 *
 * Uso: npm run db:seed:accounts
 */

type Acct = {
  name: string;
  type: 'bank_checking' | 'bank_savings' | 'credit_card' | 'cash' | 'broker' | 'ewallet';
  currency: 'ARS' | 'USD';
  institution: string | null;
  owner: string;
};

const ACCOUNTS: Acct[] = [
  // Nico — Galicia
  { name: 'Galicia Amex', type: 'credit_card', currency: 'ARS', institution: 'Galicia', owner: 'Nico' },
  { name: 'Galicia Visa', type: 'credit_card', currency: 'ARS', institution: 'Galicia', owner: 'Nico' },
  { name: 'Galicia Master', type: 'credit_card', currency: 'ARS', institution: 'Galicia', owner: 'Nico' },
  // Nico — ICBC
  { name: 'ICBC Visa', type: 'credit_card', currency: 'ARS', institution: 'ICBC', owner: 'Nico' },
  { name: 'ICBC Master', type: 'credit_card', currency: 'ARS', institution: 'ICBC', owner: 'Nico' },
  { name: 'ICBC Caja Ahorro', type: 'bank_savings', currency: 'ARS', institution: 'ICBC', owner: 'Nico' },
  { name: 'ICBC Inversiones', type: 'broker', currency: 'ARS', institution: 'ICBC', owner: 'Nico' },
  // Nico — BNA
  { name: 'BNA Visa', type: 'credit_card', currency: 'ARS', institution: 'BNA', owner: 'Nico' },
  // Nico — HSBC US
  { name: 'HSBC US TC', type: 'credit_card', currency: 'USD', institution: 'HSBC US', owner: 'Nico' },
  { name: 'HSBC US Cuenta', type: 'bank_checking', currency: 'USD', institution: 'HSBC US', owner: 'Nico' },
  // Nico — Brokers
  { name: 'Balanz', type: 'broker', currency: 'ARS', institution: 'Balanz', owner: 'Nico' },
  { name: 'Cocos', type: 'broker', currency: 'ARS', institution: 'Cocos', owner: 'Nico' },
  // Nico — E-wallet
  { name: 'Mercado Pago', type: 'ewallet', currency: 'ARS', institution: 'Mercado Pago', owner: 'Nico' },
  // Hogar — Cash
  { name: 'Cash USD', type: 'cash', currency: 'USD', institution: null, owner: 'Hogar' },
  { name: 'Cash ARS', type: 'cash', currency: 'ARS', institution: null, owner: 'Hogar' },
  // Pau — Galicia
  { name: 'Galicia Caja Ahorro', type: 'bank_savings', currency: 'ARS', institution: 'Galicia', owner: 'Pau' },
  { name: 'Galicia Visa', type: 'credit_card', currency: 'ARS', institution: 'Galicia', owner: 'Pau' },
  { name: 'Galicia Master', type: 'credit_card', currency: 'ARS', institution: 'Galicia', owner: 'Pau' },
  { name: 'Galicia Inversiones', type: 'broker', currency: 'ARS', institution: 'Galicia', owner: 'Pau' },
];

async function main() {
  loadEnv();
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) throw new Error('DIRECT_URL must be set');

  const sql = postgres(directUrl, { max: 1 });

  try {
    const households = await sql<{ id: string }[]>`select id from public.households`;
    if (households.length === 0) {
      console.warn('[seed-accounts] no hay households — corré db:seed:household primero');
      return;
    }
    if (households.length > 1) {
      console.warn(`[seed-accounts] ${households.length} households — este script asume 1`);
      return;
    }
    const hhId = households[0]!.id;

    // Pre-load institution IDs
    const instRows = await sql<{ id: string; name: string }[]>`
      select id, name from public.institutions
    `;
    const instByName = new Map(instRows.map((r) => [r.name, r.id]));

    let inserted = 0;
    let skipped = 0;

    for (const acct of ACCOUNTS) {
      // Check idempotency by (household_id, name, owner_tag) to handle
      // duplicate names across owners (e.g. "Galicia Visa" Nico vs Pau)
      const existing = await sql<{ id: string }[]>`
        select id from public.accounts
        where household_id = ${hhId}
          and name = ${acct.name}
          and owner_tag = ${acct.owner}
        limit 1
      `;
      if (existing[0]) {
        skipped++;
        continue;
      }

      const institutionId = acct.institution ? instByName.get(acct.institution) : null;
      if (acct.institution && !institutionId) {
        throw new Error(
          `Institución "${acct.institution}" no encontrada en DB. Corré db:seed:institutions primero.`,
        );
      }

      await sql`
        insert into public.accounts (household_id, name, type, currency_default, institution_id, owner_tag)
        values (${hhId}, ${acct.name}, ${acct.type}, ${acct.currency}, ${institutionId ?? null}, ${acct.owner})
      `;
      inserted++;
    }

    console.warn(`[seed-accounts] ${inserted} cuentas creadas, ${skipped} ya existían`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('[seed-accounts] failed:', err);
  process.exit(1);
});
