import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './_env';

/**
 * DEV ONLY: borra datos de prueba del household para empezar fresco con info
 * real. Por flags, scopeado al único household. NUNCA toca: categories, tags,
 * fx_rates, institutions, financial_goals, profiles, auth.
 *
 * Uso:
 *   npm run db:wipe-smoke -- [flags] [--dry-run]
 *
 * Flags:
 *   --transactions   Borra transactions + transaction_tags
 *   --imports        Borra imports + import_lines + archivos en bucket
 *   --recurrences    Borra recurrences (forecasts cascadea)
 *   --budgets        Borra budgets
 *   --accounts       Borra accounts (FORZA --transactions + --imports +
 *                    --recurrences porque las FKs son RESTRICT)
 *   --all            Equivalente a todas las flags anteriores
 *   --dry-run        Solo muestra los counts; no borra nada
 */

const FLAGS = process.argv.slice(2);
const has = (flag: string) => FLAGS.includes(flag);
const dryRun = has('--dry-run');
const all = has('--all');

const wantAccounts = all || has('--accounts');
const wantRecurrences = all || has('--recurrences') || wantAccounts;
const wantImports = all || has('--imports') || wantAccounts;
const wantTransactions = all || has('--transactions') || wantAccounts;
const wantBudgets = all || has('--budgets');

const requested =
  wantTransactions || wantImports || wantRecurrences || wantBudgets || wantAccounts;
if (!requested) {
  console.error(
    'Specify at least one flag: --transactions --imports --recurrences --budgets --accounts --all  [--dry-run]',
  );
  process.exit(1);
}

async function main() {
  loadEnv();

  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) throw new Error('DIRECT_URL must be set');

  const sql = postgres(directUrl, { max: 1 });
  try {
    const households = await sql<{ id: string; name: string }[]>`
      select id, name from public.households
    `;
    if (households.length === 0) {
      console.warn('[wipe-smoke] no household found. Aborting.');
      return;
    }
    if (households.length > 1) {
      console.warn(
        `[wipe-smoke] ${households.length} households found. Aborting — this script asumes 1 household.`,
      );
      return;
    }
    const household = households[0]!;
    const hhId = household.id;

    console.warn(`[wipe-smoke] household: ${household.name} (${hhId})`);
    console.warn('[wipe-smoke] targets:', {
      transactions: wantTransactions,
      imports: wantImports,
      recurrences: wantRecurrences,
      budgets: wantBudgets,
      accounts: wantAccounts,
    });
    console.warn(`[wipe-smoke] dry-run: ${dryRun}`);

    const countOf = async (table: string, where: string = `household_id = '${hhId}'`) => {
      const r = await sql.unsafe(
        `select count(*)::int as n from public.${table} where ${where}`,
      );
      return Number((r[0] as { n: number } | undefined)?.n ?? 0);
    };

    const before = {
      transactions: await countOf('transactions'),
      transaction_tags: await countOf(
        'transaction_tags',
        `transaction_id in (select id from public.transactions where household_id = '${hhId}')`,
      ),
      imports: await countOf('imports'),
      import_lines: await countOf(
        'import_lines',
        `import_id in (select id from public.imports where household_id = '${hhId}')`,
      ),
      recurrences: await countOf('recurrences'),
      forecasts: await countOf(
        'forecasts',
        `recurrence_id in (select id from public.recurrences where household_id = '${hhId}')`,
      ),
      budgets: await countOf('budgets'),
      accounts: await countOf('accounts'),
    };
    console.warn('[wipe-smoke] counts before:', before);

    if (dryRun) {
      console.warn('[wipe-smoke] DRY RUN — nada se borró');
      return;
    }

    // Storage primero para no dejar huérfanos si imports va a borrarse.
    if (wantImports) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const secret = process.env.SUPABASE_SECRET_KEY;
      if (url && secret) {
        const admin = createClient(url, secret, { auth: { persistSession: false } });
        const { data: files, error: listErr } = await admin.storage
          .from('imports')
          .list(hhId, { limit: 1000 });
        if (listErr) {
          console.warn('[wipe-smoke] storage list error:', listErr.message);
        } else if (files && files.length > 0) {
          const paths = files.map((f) => `${hhId}/${f.name}`);
          const { error: rmErr } = await admin.storage.from('imports').remove(paths);
          if (rmErr) console.warn('[wipe-smoke] storage remove error:', rmErr.message);
          else console.warn(`[wipe-smoke] storage: removed ${paths.length} files`);
        } else {
          console.warn('[wipe-smoke] storage: no files in household path');
        }
      } else {
        console.warn(
          '[wipe-smoke] storage: skipping (NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY no están seteadas)',
        );
      }
    }

    // SQL deletes en orden de dependencias (todo en una sola transacción).
    await sql.begin(async (tx) => {
      if (wantTransactions) {
        await tx`delete from public.transaction_tags where transaction_id in (select id from public.transactions where household_id = ${hhId})`;
      }
      if (wantImports) {
        await tx`delete from public.import_lines where import_id in (select id from public.imports where household_id = ${hhId})`;
        await tx`delete from public.imports where household_id = ${hhId}`;
      }
      if (wantRecurrences) {
        // forecasts cascadea pero igual borramos explícito para counting limpio.
        await tx`delete from public.forecasts where recurrence_id in (select id from public.recurrences where household_id = ${hhId})`;
      }
      if (wantTransactions) {
        await tx`delete from public.transactions where household_id = ${hhId}`;
      }
      if (wantRecurrences) {
        await tx`delete from public.recurrences where household_id = ${hhId}`;
      }
      if (wantBudgets) {
        await tx`delete from public.budgets where household_id = ${hhId}`;
      }
      if (wantAccounts) {
        await tx`delete from public.accounts where household_id = ${hhId}`;
      }
    });

    const after = {
      transactions: await countOf('transactions'),
      transaction_tags: await countOf(
        'transaction_tags',
        `transaction_id in (select id from public.transactions where household_id = '${hhId}')`,
      ),
      imports: await countOf('imports'),
      import_lines: await countOf(
        'import_lines',
        `import_id in (select id from public.imports where household_id = '${hhId}')`,
      ),
      recurrences: await countOf('recurrences'),
      forecasts: await countOf(
        'forecasts',
        `recurrence_id in (select id from public.recurrences where household_id = '${hhId}')`,
      ),
      budgets: await countOf('budgets'),
      accounts: await countOf('accounts'),
    };
    console.warn('[wipe-smoke] counts after:', after);
    console.warn('[wipe-smoke] done');
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('[wipe-smoke] failed:', err);
  process.exit(1);
});
