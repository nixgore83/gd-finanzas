import { createClient } from '@supabase/supabase-js';
import { and, desc, eq, gte, inArray, lte, ne, or, sql } from 'drizzle-orm';
import { loadEnv } from './_env';
import {
  KNOWN_CATEGORIES,
  cuotaDateAtClose,
  decideLine,
  counterpartyHasStrongId,
  counterpartyIsHousehold,
  type Decision,
  type LineInput,
  type ReviewAccount,
  type ReviewContext,
} from '../lib/imports/bulk-review';
import { findAlreadyImported } from '../lib/imports/duplicate-detection';
import { parsedTxLineSchema } from '../lib/imports/parsers/types';

/**
 * Revisión asistida + confirmación masiva de imports ya parseados.
 *
 * Por qué existe: revisar a mano 800 líneas por mes es lo que hacía inviable
 * mantener la app al día. El script toma las decisiones MECÁNICAS con reglas
 * explícitas (`lib/imports/bulk-review.ts`) y confirma con la MISMA función que
 * usa la UI (`confirmImportInternal`), así que el pareo de transferencias, el
 * aprendizaje de refs y el auto-match corren igual que en la pantalla.
 *
 * Lo que no puede decidir queda `pending`, el import NO se confirma y se lista
 * el motivo: la revisión humana sigue siendo el último paso para esas líneas.
 * Solo toca líneas `pending`: lo que alguien ya editó/aceptó/rechazó se respeta.
 *
 * Uso:
 *   npm run imports:confirm -- --dry-run                 (imports parsed/reviewing de hoy)
 *   npm run imports:confirm -- --since 2026-10-01
 *   npm run imports:confirm -- --import <uuid> [--import <uuid>]
 *   npm run imports:confirm -- --as nixgore@gmail.com    (quién figura como created_by)
 */

const FLAGS = process.argv.slice(2);
function flagValues(name: string): string[] {
  const out: string[] = [];
  FLAGS.forEach((f, i) => {
    if (f === name && FLAGS[i + 1]) out.push(FLAGS[i + 1]!);
  });
  return out;
}
const DRY_RUN = FLAGS.includes('--dry-run');
/** Con --dry-run: escribe un JSON con las líneas que quedarían pendientes (id, motivo). */
const PENDING_OUT = flagValues('--pending-out')[0] ?? null;
const IMPORT_IDS = flagValues('--import');
const SINCE = flagValues('--since')[0] ?? new Date().toISOString().slice(0, 10);
const AS_EMAIL = flagValues('--as')[0] ?? null;

/** Prefijos de CUIT/CUIL de personas físicas. */
const CUIT_RE = /^(20|23|24|27)\d{9}$/;

function shiftIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function mask(desc: string): string {
  return desc.replace(/\d{5,}/g, '#').slice(0, 48);
}

async function main() {
  loadEnv();
  const { getDb } = await import('../lib/db/client');
  const { confirmImportInternal } = await import('../lib/imports/confirm-internal');
  const { accounts, categories, householdMembers, imports, importLines, institutions, transactions } =
    await import('../db/schema');
  const db = getDb();

  // ── Identidad: household + usuario que firma las transacciones ───────────
  const email =
    AS_EMAIL ??
    (process.env.ALLOWED_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)[0];
  if (!email) throw new Error('Falta --as <email> (o ALLOWED_EMAILS en .env.local)');
  // El rol de DB local no lee `auth.users`; el id del usuario se resuelve por la
  // admin API de Supabase (service role), igual que `dev-login`.
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supaSecret = process.env.SUPABASE_SECRET_KEY;
  if (!supaUrl || !supaSecret) throw new Error('NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY requeridos');
  const supabase = createClient(supaUrl, supaSecret, { auth: { persistSession: false } });
  const { data: usersPage, error: usersErr } = await supabase.auth.admin.listUsers({ perPage: 50 });
  if (usersErr) throw usersErr;
  const userId = usersPage.users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase())?.id;
  if (!userId) throw new Error(`No existe el usuario ${email}`);
  const [memb] = await db
    .select({ householdId: householdMembers.householdId })
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId))
    .limit(1);
  if (!memb) throw new Error('El usuario no pertenece a ningún household');
  const householdId = memb.householdId;
  const session = { userId, householdId };

  // ── Contexto compartido ──────────────────────────────────────────────────
  const accountRows = await db
    .select({
      id: accounts.id,
      institutionName: institutions.name,
      type: accounts.type,
      cardBrand: accounts.cardBrand,
      currency: accounts.currencyDefault,
      ownerTag: accounts.ownerTag,
      transferRefs: accounts.transferRefs,
      name: accounts.name,
    })
    .from(accounts)
    .leftJoin(institutions, eq(accounts.institutionId, institutions.id))
    .where(eq(accounts.householdId, householdId));
  const reviewAccounts: ReviewAccount[] = accountRows.map((a) => ({
    id: a.id,
    institutionName: a.institutionName,
    type: a.type,
    cardBrand: a.cardBrand,
    currency: a.currency,
    ownerTag: a.ownerTag,
    transferRefs: a.transferRefs,
  }));
  const accountLabel = (id: string): string => {
    const a = accountRows.find((r) => r.id === id);
    if (!a) return id;
    return `${a.institutionName ?? '—'} ${a.cardBrand ?? a.type}${a.name ? ` ${a.name}` : ''} · ${a.ownerTag} · ${a.currency}`;
  };

  // Los CUIT de los miembros salen de las refs aprendidas en las cuentas: no
  // se hardcodean identificadores personales en el repo.
  const householdCuits = [
    ...new Set(
      reviewAccounts
        .flatMap((a) => a.transferRefs ?? [])
        .map((r) => r.replace(/\D/g, ''))
        .filter((r) => CUIT_RE.test(r)),
    ),
  ];

  // Nombres completos de los miembros tal como los imprimen los bancos, para
  // reconocer "Transferencia enviada <yo>" donde no viene CUIT. Salen de las
  // contrapartes ya confirmadas cuyo CUIT es de un miembro (`imports.
  // statement_holder` está vacío en toda la base, no sirve de fuente).
  const nameRows =
    householdCuits.length === 0
      ? []
      : ((await db.execute(
          sql`select distinct meta->'counterparty'->>'name' as name
              from transactions
              where household_id = ${householdId}
                and regexp_replace(coalesce(meta->'counterparty'->>'cuil', ''), '\\D', '', 'g') in (${sql.join(
                  householdCuits.map((c) => sql`${c}`),
                  sql`, `,
                )})
                and coalesce(meta->'counterparty'->>'name', '') <> ''`,
        )) as unknown as Array<{ name: string }>);
  const householdNames = [...new Set(nameRows.map((r) => r.name.trim()).filter(Boolean))];
  console.warn(`[confirm] miembros reconocidos por nombre: ${householdNames.length}`);

  const catRows = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(eq(categories.householdId, householdId), eq(categories.archived, false)));
  const categoryIdByName = new Map<string, string>();
  for (const c of catRows) {
    const k = c.name.trim().toLowerCase();
    if ((KNOWN_CATEGORIES as readonly string[]).includes(k)) categoryIdByName.set(k, c.id);
  }
  const categoryName = new Map(catRows.map((c) => [c.id, c.name] as const));

  // ── Imports a procesar ───────────────────────────────────────────────────
  const importRows = await db
    .select({
      id: imports.id,
      accountId: imports.accountId,
      fileName: imports.fileName,
      status: imports.status,
      periodEnd: imports.periodEnd,
    })
    .from(imports)
    .where(
      and(
        eq(imports.householdId, householdId),
        // Un import ya confirmado puede volver a tener líneas pendientes (se
        // des-rechazó una); por id se admite, por fecha no se lo vuelve a tocar.
        inArray(
          imports.status,
          IMPORT_IDS.length > 0 ? ['parsed', 'reviewing', 'confirmed'] : ['parsed', 'reviewing'],
        ),
        IMPORT_IDS.length > 0
          ? inArray(imports.id, IMPORT_IDS)
          : gte(imports.createdAt, new Date(`${SINCE}T00:00:00Z`)),
      ),
    )
    .orderBy(imports.createdAt);

  console.warn(
    `[confirm] ${importRows.length} import(s) ${DRY_RUN ? '(DRY RUN) ' : ''}como ${email}`,
  );

  let totalConfirmed = 0;
  let totalCreated = 0;
  const totals = { accept: 0, edit: 0, reject: 0, pending: 0 };
  const pendingOut: Array<{ id: string; importId: string; file: string | null; reason: string }> = [];

  for (const imp of importRows) {
    if (!imp.accountId) {
      console.warn(`\n— ${imp.fileName}: sin cuenta, salteado`);
      continue;
    }
    const account = reviewAccounts.find((a) => a.id === imp.accountId);
    if (!account) {
      console.warn(`\n— ${imp.fileName}: cuenta desconocida, salteado`);
      continue;
    }
    const ctx: ReviewContext = {
      account,
      accounts: reviewAccounts,
      householdCuits,
      householdNames,
      categoryIdByName,
      periodEnd: imp.periodEnd,
    };

    const lineRows = await db
      .select({
        id: importLines.id,
        parsedData: importLines.parsedData,
        proposedCategoryId: importLines.proposedCategoryId,
      })
      .from(importLines)
      .where(and(eq(importLines.importId, imp.id), eq(importLines.status, 'pending')))
      .orderBy(importLines.createdAt);

    // Duplicados contra transacciones de la MISMA cuenta que no vengan de este import.
    const parsedLines = lineRows.map((r) => ({ row: r, parsed: parsedTxLineSchema.safeParse(r.parsedData) }));
    const dates = parsedLines.filter((p) => p.parsed.success).map((p) => p.parsed.data!.date).sort();
    let duplicateIds = new Set<string>();
    if (dates.length > 0) {
      const existing = await db
        .select({ id: transactions.id, date: transactions.date, amount: transactions.amountOriginal })
        .from(transactions)
        .where(
          and(
            eq(transactions.householdId, householdId),
            eq(transactions.accountId, imp.accountId),
            or(sql`${transactions.importBatchId} is null`, ne(transactions.importBatchId, imp.id)),
            gte(transactions.date, shiftIso(dates[0]!, -1)),
            lte(transactions.date, shiftIso(dates[dates.length - 1]!, 1)),
          ),
        );
      // Las cuotas se comparan con la fecha que van a tener (el cierre), no con
      // la del consumo original: si no, la cuota 3 "duplica" a la cuota 1.
      duplicateIds = findAlreadyImported(
        parsedLines
          .filter((p) => p.parsed.success)
          .map((p) => ({
            id: p.row.id,
            date: cuotaDateAtClose(p.parsed.data!, ctx) ?? p.parsed.data!.date,
            amount: p.parsed.data!.amountOriginal,
          })),
        existing,
      );
    }

    // Historial por contraparte: SOLO transacciones confirmadas (no otras líneas
    // pendientes, que traen sugerencias sin validar). Categoría más frecuente de
    // los movimientos no-transfer a esa contraparte.
    const historyCache = new Map<string, string | null>();
    const historyFor = async (cp: NonNullable<LineInput['parsed']['counterparty']>): Promise<string | null> => {
      const key = `${cp.cuil ?? ''}|${cp.cbu ?? ''}|${cp.accountRef ?? ''}|${cp.alias ?? ''}`;
      if (historyCache.has(key)) return historyCache.get(key)!;
      const conds = [
        cp.cuil ? sql`${transactions.meta}->'counterparty'->>'cuil' = ${cp.cuil}` : null,
        cp.cbu ? sql`${transactions.meta}->'counterparty'->>'cbu' = ${cp.cbu}` : null,
        cp.accountRef ? sql`${transactions.meta}->'counterparty'->>'accountRef' = ${cp.accountRef}` : null,
        cp.alias ? sql`${transactions.meta}->'counterparty'->>'alias' = ${cp.alias}` : null,
      ].filter((c): c is NonNullable<typeof c> => c !== null);
      const rows = await db
        .select({ categoryId: transactions.categoryId, kind: transactions.kind, n: sql<number>`count(*)::int` })
        .from(transactions)
        .where(and(eq(transactions.householdId, householdId), ne(transactions.kind, 'transfer'), or(...conds)))
        .groupBy(transactions.categoryId, transactions.kind)
        .orderBy(desc(sql`count(*)`));
      const best = rows.find((r) => r.categoryId)?.categoryId ?? null;
      historyCache.set(key, best);
      return best;
    };

    const decisions: Array<{ id: string; descr: string; decision: Decision }> = [];
    for (const { row, parsed } of parsedLines) {
      if (!parsed.success) {
        decisions.push({ id: row.id, descr: '?', decision: { action: 'pending', reason: 'parsed_data inválida' } });
        continue;
      }
      const line: LineInput = {
        id: row.id,
        parsed: parsed.data,
        proposedCategoryId: row.proposedCategoryId,
        historyCategoryId: null,
        isDuplicate: duplicateIds.has(row.id),
      };
      if (
        account.type !== 'credit_card' &&
        parsed.data.isTransfer &&
        !parsed.data.transferAccountId &&
        parsed.data.counterparty &&
        counterpartyHasStrongId(parsed.data.counterparty) &&
        !counterpartyIsHousehold(line, ctx)
      ) {
        line.historyCategoryId = await historyFor(parsed.data.counterparty);
      }
      decisions.push({ id: row.id, descr: parsed.data.description, decision: decideLine(ctx, line) });
    }

    // ── Aplicar ──────────────────────────────────────────────────────────
    const counts = { accept: 0, edit: 0, reject: 0, pending: 0 };
    for (const d of decisions) counts[d.decision.action] += 1;
    for (const k of Object.keys(counts) as Array<keyof typeof counts>) totals[k] += counts[k];

    console.warn(`\n— ${imp.fileName} → ${accountLabel(imp.accountId)}`);
    console.warn(
      `   pendientes ${decisions.length}: acepto ${counts.accept} · corrijo ${counts.edit} · duplicadas ${counts.reject} · quedan ${counts.pending}`,
    );
    const edits = decisions.filter((d) => d.decision.action === 'edit');
    const byReason = new Map<string, number>();
    for (const e of edits) byReason.set(e.decision.reason, (byReason.get(e.decision.reason) ?? 0) + 1);
    for (const [reason, n] of byReason) console.warn(`     corrijo · ${reason}: ${n}`);
    const pend = decisions.filter((d) => d.decision.action === 'pending');
    const pendByReason = new Map<string, string[]>();
    for (const p of pend) {
      const list = pendByReason.get(p.decision.reason) ?? [];
      list.push(mask(p.descr));
      pendByReason.set(p.decision.reason, list);
    }
    for (const [reason, items] of pendByReason) {
      console.warn(`     queda · ${reason}: ${items.length}  (${[...new Set(items)].slice(0, 4).join(' | ')})`);
    }
    for (const p of pend) pendingOut.push({ id: p.id, importId: imp.id, file: imp.fileName, reason: p.decision.reason });

    if (DRY_RUN) continue;

    for (const d of decisions) {
      const dec = d.decision;
      if (dec.action === 'accept') {
        await db.update(importLines).set({ status: 'accepted' }).where(eq(importLines.id, d.id));
      } else if (dec.action === 'edit') {
        await db
          .update(importLines)
          .set({ status: 'edited', parsedData: dec.parsed, proposedCategoryId: dec.proposedCategoryId })
          .where(eq(importLines.id, d.id));
      } else if (dec.action === 'reject') {
        await db
          .update(importLines)
          .set({ status: 'rejected', parsedData: dec.parsed })
          .where(eq(importLines.id, d.id));
      }
    }

    const [stillPending] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(importLines)
      .where(and(eq(importLines.importId, imp.id), eq(importLines.status, 'pending')));
    if ((stillPending?.n ?? 0) > 0) {
      console.warn(`   ✋ no se confirma: ${stillPending!.n} línea(s) pendientes para revisión humana`);
      continue;
    }

    const res = await confirmImportInternal({ importId: imp.id, accountId: imp.accountId }, session);
    if (!res.ok) {
      console.warn(`   ✖ confirm falló: ${res.error}${res.message ? ` — ${res.message}` : ''}`);
      continue;
    }
    totalConfirmed += res.remaining === 0 ? 1 : 0;
    totalCreated += res.createdCount;
    console.warn(
      `   ✔ ${res.remaining === 0 ? 'confirmado' : 'PARCIAL'}: ${res.createdCount} transacciones, ${res.autoMatchCount} previsiones matcheadas${res.lineErrors.length ? `, ${res.lineErrors.length} con error` : ''}`,
    );
    const errByReason = new Map<string, number>();
    for (const e of res.lineErrors) errByReason.set(e.reason, (errByReason.get(e.reason) ?? 0) + 1);
    for (const [reason, n] of errByReason) console.warn(`     error · ${reason}: ${n}`);
  }

  console.warn(
    `\n[confirm] líneas: acepto ${totals.accept} · corrijo ${totals.edit} · duplicadas ${totals.reject} · quedan ${totals.pending}`,
  );
  if (!DRY_RUN) {
    console.warn(`[confirm] imports confirmados: ${totalConfirmed} · transacciones creadas: ${totalCreated}`);
  }
  if (DRY_RUN && PENDING_OUT) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(PENDING_OUT, JSON.stringify(pendingOut, null, 1));
    console.warn(`[confirm] ${pendingOut.length} línea(s) pendientes escritas en ${PENDING_OUT}`);
  }
  // Para que el reporte sea legible, los nombres de categoría usados en correcciones:
  void categoryName;
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('[confirm] failed:', err);
  process.exit(1);
});
