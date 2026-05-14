/**
 * Smoke test de RLS: simula una sesión authenticated y verifica que las
 * policies de Hito 1 (a) no bloqueen lo válido y (b) no dejen pasar lo que
 * pertenece a otra household.
 *
 * No es un test automatizado — corre puntual, imprime un resumen y no afecta
 * datos reales (crea y limpia una household ficticia). Pensado para gatillarse
 * con `npx tsx scripts/smoke-rls.ts` después de aplicar 0002_v1_core_rls.sql.
 *
 * Cada caso se ejecuta en su propia transacción: si un INSERT viola RLS, la
 * transacción queda abortada y subsiguientes statements fallarían en cascada;
 * aislarlos evita ese problema.
 */

import postgres from 'postgres';
import type { TransactionSql } from 'postgres';
import { loadEnv } from './_env';

type Sql = ReturnType<typeof postgres>;
type Tx = TransactionSql;

const results: { name: string; ok: boolean; detail?: string }[] = [];

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.warn(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function asAuthenticated<T>(
  sql: Sql,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`set local role authenticated`;
    await tx.unsafe(
      `set local "request.jwt.claims" = '${JSON.stringify({ sub: userId, role: 'authenticated' })}'`,
    );
    return fn(tx);
  })) as T;
}

async function expectRlsViolation(name: string, p: Promise<unknown>) {
  try {
    await p;
    record(name, false, 'no falló');
  } catch (err) {
    const msg = (err as Error).message;
    record(name, /row-level security|violates|permission/i.test(msg), msg.slice(0, 80));
  }
}

async function main() {
  loadEnv();

  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) throw new Error('DIRECT_URL must be set');

  const sql = postgres(directUrl, { max: 1 });

  try {
    console.warn('[smoke-rls] arrancando');

    const [nico] = await sql<{ id: string; email: string }[]>`
      select id, email from auth.users where email = 'nixgore@gmail.com' limit 1
    `;
    if (!nico) throw new Error('nico user not found');

    const [memb] = await sql<{ household_id: string }[]>`
      select household_id from household_members where user_id = ${nico.id} limit 1
    `;
    if (!memb) throw new Error('nico household membership not found');

    const nicoHouseholdId = memb.household_id;
    console.warn(`[smoke-rls] nico=${nico.id.slice(0, 8)}… household=${nicoHouseholdId.slice(0, 8)}…`);

    const [fake] = await sql<{ id: string }[]>`
      insert into households (name) values ('__smoke_other__') returning id
    `;
    if (!fake) throw new Error('failed to create fake household');
    const fakeHouseholdId = fake.id;
    console.warn(`[smoke-rls] fake household=${fakeHouseholdId.slice(0, 8)}…`);

    // Seed account ajena vía postgres role (bypass RLS) para validar SELECT.
    await sql`
      insert into accounts (household_id, name, type, currency_default, owner_tag)
      values (${fakeHouseholdId}, '__smoke_acc_ajena_seeded__', 'cash', 'ARS', 'Nico')
    `;

    // --- INSERT propia ---
    try {
      const inserted = await asAuthenticated(sql, nico.id, (tx) => tx<{ id: string }[]>`
        insert into accounts (household_id, name, type, currency_default, owner_tag)
        values (${nicoHouseholdId}, '__smoke_acc__', 'cash', 'ARS', 'Nico')
        returning id
      `);
      const acc = inserted[0];
      if (!acc) throw new Error('insert returned no row');
      record('INSERT account propia', true, `id=${acc.id.slice(0, 8)}…`);
    } catch (err) {
      record('INSERT account propia', false, (err as Error).message);
    }

    // --- INSERT ajena (debe fallar) ---
    await expectRlsViolation(
      'INSERT account ajena (debe fallar)',
      asAuthenticated(sql, nico.id, (tx) => tx`
        insert into accounts (household_id, name, type, currency_default, owner_tag)
        values (${fakeHouseholdId}, '__smoke_acc_ajena__', 'cash', 'ARS', 'Nico')
      `),
    );

    // --- SELECT solo accounts propias ---
    try {
      const visible = await asAuthenticated(sql, nico.id, (tx) => tx<{ household_id: string; name: string }[]>`
        select household_id, name from accounts where name like '__smoke%'
      `);
      const seesOwn = visible.some((r) => r.household_id === nicoHouseholdId);
      const seesAlien = visible.some((r) => r.household_id === fakeHouseholdId);
      record('SELECT accounts: ve propia, no ajena', seesOwn && !seesAlien, `${visible.length} fila(s)`);
    } catch (err) {
      record('SELECT accounts: ve propia, no ajena', false, (err as Error).message);
    }

    // --- SELECT households solo propia ---
    try {
      const hs = await asAuthenticated(sql, nico.id, (tx) => tx<{ id: string; name: string }[]>`
        select id, name from households
      `);
      const onlyOwn = hs.length === 1 && hs[0]?.id === nicoHouseholdId;
      record('SELECT households: solo propia', onlyOwn, `${hs.length} fila(s)`);
    } catch (err) {
      record('SELECT households: solo propia', false, (err as Error).message);
    }

    // --- institutions SELECT abierto ---
    try {
      await asAuthenticated(sql, nico.id, (tx) => tx`select 1 from institutions limit 0`);
      record('SELECT institutions: abierto', true);
    } catch (err) {
      record('SELECT institutions: abierto', false, (err as Error).message);
    }

    // --- institutions INSERT denegado para authenticated ---
    await expectRlsViolation(
      'INSERT institutions: denegado',
      asAuthenticated(sql, nico.id, (tx) => tx`
        insert into institutions (name, country, default_currency)
        values ('__smoke_inst__', 'AR', 'ARS')
      `),
    );

    // --- fx_rates: SELECT abierto, INSERT denegado ---
    try {
      await asAuthenticated(sql, nico.id, (tx) => tx`select 1 from fx_rates limit 0`);
      record('SELECT fx_rates: abierto', true);
    } catch (err) {
      record('SELECT fx_rates: abierto', false, (err as Error).message);
    }
    await expectRlsViolation(
      'INSERT fx_rates: denegado',
      asAuthenticated(sql, nico.id, (tx) => tx`
        insert into fx_rates (date, currency_pair, source, mid)
        values ('2099-01-01', 'USD/ARS', 'smoke', 1)
      `),
    );

    // Cleanup
    console.warn('[smoke-rls] cleanup');
    await sql`delete from accounts where name like '__smoke%'`;
    await sql`delete from households where id = ${fakeHouseholdId}`;
  } finally {
    await sql.end();
  }

  const failures = results.filter((r) => !r.ok);
  console.warn('');
  console.warn(`[smoke-rls] ${results.length - failures.length}/${results.length} ok`);
  if (failures.length > 0) {
    console.error('[smoke-rls] FALLAS:');
    for (const f of failures) console.error(`  - ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('[smoke-rls] crashed:', err);
  process.exit(1);
});
