import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { eq } from 'drizzle-orm';
import { loadEnv } from './_env';
import { contentTypeForExt, extractExtension } from '../lib/schemas/import';
import {
  accountNumberMatchesHint,
  buildPlan,
  extractStatementDate,
  routeFile,
  type PlanEntry,
  type PlannedFile,
  type RouteTarget,
} from '../lib/imports/bulk-routing';

/**
 * Carga masiva de extractos desde una carpeta local (típicamente el Drive
 * sincronizado con los resúmenes).
 *
 * Por qué existe: cargar los resúmenes de a uno por la UI se volvió el cuello de
 * botella del proyecto. La carpeta tiene ~142 archivos para ~50 resúmenes reales
 * (el mismo resumen re-descargado 2-3 veces con bytes distintos), así que subirla
 * cruda reintroduce los duplicados que se limpiaron a mano en jun/jul 2026.
 *
 * Defensa en tres capas, TODAS antes de gastar un token de LLM:
 *  1. dedup local por (cuenta, fecha de cierre) — `lib/imports/bulk-routing.ts`
 *  2. dedup contra la DB por `file_hash`
 *  3. aviso de período solapado contra los imports ya cargados de esa cuenta
 *
 * Y una verificación de contenido best-effort: se lee la primera página del PDF
 * (sin LLM) y se contrasta el titular/tipo de cuenta contra la cuenta destino que
 * dedujo la regla. Una contradicción explícita marca CONFLICTO y NO se sube.
 *
 * NUNCA confirma un import: deja todo en revisión humana, como manda el PRD.
 *
 * Uso:
 *   npm run imports:bulk -- --dir "<carpeta>" --dry-run
 *   npm run imports:bulk -- --dir "<carpeta>" --only "TC/Visa Pau"
 */

const FLAGS = process.argv.slice(2);
function flagValue(name: string): string | null {
  const i = FLAGS.indexOf(name);
  return i >= 0 ? (FLAGS[i + 1] ?? null) : null;
}
const DRY_RUN = FLAGS.includes('--dry-run');
const DIR = flagValue('--dir');
const ONLY = flagValue('--only');
const LIMIT = Number(flagValue('--limit') ?? '0');
/** Sube aunque el período se solape con un import existente. Último recurso. */
const FORCE = FLAGS.includes('--force');

type Status =
  | 'NUEVO'
  | 'YA_CARGADO'
  | 'DUP_LOCAL'
  | 'POSIBLE_DUP'
  | 'CONFLICTO'
  | 'SIN_RUTEO'
  | 'SIN_CUENTA'
  | 'SIN_FECHA';

type Row = {
  relPath: string;
  status: Status;
  target: RouteTarget | null;
  accountId: string | null;
  institutionId: string | null;
  accountLabel: string;
  date: string;
  detail: string;
  hash: string;
  bytes: Uint8Array | null;
};

/** Estados que se suben. SIN_FECHA sube igual: se dedupea sólo por hash. */
const UPLOADABLE: ReadonlySet<Status> = new Set<Status>(['NUEVO', 'SIN_FECHA']);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(pdf|csv|xlsx)$/i.test(entry)) acc.push(full);
  }
  return acc;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Lee la primera página del PDF SIN LLM. Best-effort a propósito: un PDF cifrado
 * o ilegible NO bloquea la carga (el parseo real sí sabe descifrar) — sólo se
 * pierde la verificación. Devuelve null si no se pudo leer.
 */
async function firstPageText(bytes: Uint8Array): Promise<string | null> {
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: bytes });
    const res = await parser.getText({ first: 1 });
    await parser.destroy();
    return res.text || null;
  } catch {
    return null;
  }
}

const HOLDER_PATTERNS: Record<string, RegExp> = {
  Nico: /nicolas\s+mario\s+gore/i,
  Pau: /paula\s+cecilia\s+dalmasso/i,
};

/**
 * Contradicción explícita entre lo que dice el PDF y la cuenta que dedujo la
 * regla. Devuelve el motivo, o null si no hay contradicción (incluye el caso
 * "no se pudo verificar", que NO es contradicción).
 */
function contentConflict(text: string | null, target: RouteTarget): string | null {
  if (!text) return null;

  // Titular: sólo es contradicción si aparece el OTRO titular y no el esperado.
  const expected = HOLDER_PATTERNS[target.ownerTag];
  if (expected && !expected.test(text)) {
    for (const [owner, re] of Object.entries(HOLDER_PATTERNS)) {
      if (owner !== target.ownerTag && re.test(text)) {
        return `el PDF dice titular ${owner}, la regla ruteó a ${target.ownerTag}`;
      }
    }
  }

  // Moneda de una caja de ahorro Galicia: el encabezado la nombra explícitamente.
  if (target.accountType === 'bank_savings') {
    const dice_pesos = /caja de ahorro en pesos/i.test(text);
    const dice_usd = /caja de ahorro en d[oó]lares/i.test(text);
    if (dice_pesos && !dice_usd && target.currency !== 'ARS') {
      return 'el PDF dice "Caja de Ahorro en Pesos" y la regla ruteó a USD';
    }
    if (dice_usd && !dice_pesos && target.currency !== 'USD') {
      return 'el PDF dice "Caja de Ahorro en Dólares" y la regla ruteó a ARS';
    }
  }

  return null;
}

function label(t: RouteTarget): string {
  const brand = t.cardBrand ? `/${t.cardBrand}` : '';
  const hint = t.accountHint ? ` [${t.accountHint}]` : '';
  return `${t.institutionName} ${t.accountType}${brand} ${t.currency} · ${t.ownerTag}${hint}`;
}

/** ¿Esta cuenta de la DB satisface el descriptor de la regla? */
function accountMatches(
  acc: { type: string; currency: string; cardBrand: string | null; ownerTag: string | null; institutionName: string | null; accountNumber: string | null },
  t: RouteTarget,
): boolean {
  if ((acc.institutionName ?? '').toLowerCase() !== t.institutionName.toLowerCase()) return false;
  if (acc.type !== t.accountType) return false;
  if (acc.currency !== t.currency) return false;
  if (acc.ownerTag !== t.ownerTag) return false;
  if (t.cardBrand && acc.cardBrand !== t.cardBrand) return false;
  if (t.accountHint && !accountNumberMatchesHint(acc.accountNumber, t.accountHint)) return false;
  return true;
}

/** Días entre dos fechas ISO. */
function daysBetween(a: string, b: string): number {
  const ms = Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`));
  return Math.round(ms / 86_400_000);
}

/** Tolerancia entre la fecha de cierre del nombre y el `period_end` derivado de
 *  las líneas: `period_end` es la fecha del último movimiento, que suele caer
 *  unos días antes del cierre. */
const PERIOD_OVERLAP_DAYS = 5;

async function main() {
  loadEnv();
  if (!DIR) throw new Error('Falta --dir "<carpeta>"');

  // Import dinámico: estos módulos tocan `getServerEnv()` al cargar la config de
  // DB, así que van DESPUÉS de loadEnv().
  const { getDb } = await import('../lib/db/client');
  const { createImportInternal } = await import('../lib/imports/create-internal');
  const { parseImportInternal } = await import('../lib/imports/parse-internal');
  const { accounts, institutions, imports, households } = await import('../db/schema');

  const db = getDb();

  const [household] = await db.select({ id: households.id }).from(households).limit(1);
  if (!household) throw new Error('No hay household');

  const accountRows = await db
    .select({
      id: accounts.id,
      type: accounts.type,
      currency: accounts.currencyDefault,
      cardBrand: accounts.cardBrand,
      ownerTag: accounts.ownerTag,
      accountNumber: accounts.accountNumber,
      institutionId: accounts.institutionId,
      institutionName: institutions.name,
    })
    .from(accounts)
    .leftJoin(institutions, eq(accounts.institutionId, institutions.id));

  const importRows = await db
    .select({
      accountId: imports.accountId,
      fileHash: imports.fileHash,
      periodEnd: imports.periodEnd,
      status: imports.status,
    })
    .from(imports);

  const knownHashes = new Set(importRows.map((r) => r.fileHash));
  const periodsByAccount = new Map<string, string[]>();
  for (const r of importRows) {
    if (!r.accountId || !r.periodEnd) continue;
    periodsByAccount.set(r.accountId, [...(periodsByAccount.get(r.accountId) ?? []), r.periodEnd]);
  }

  // ── Plan local (ruteo + dedup por cuenta/fecha) ────────────────────────────
  let files = walk(DIR);
  if (ONLY) {
    const needle = ONLY.replace(/\\/g, '/').toLowerCase();
    files = files.filter((f) => relative(DIR, f).replace(/\\/g, '/').toLowerCase().startsWith(needle));
  }

  const planned: PlannedFile[] = files.map((full) => {
    const rel = relative(DIR, full);
    return { relPath: rel, rule: routeFile(rel), date: extractStatementDate(basename(rel)) };
  });
  const plan: PlanEntry[] = buildPlan(planned);

  // ── Resolver cada entrada contra la DB ─────────────────────────────────────
  const rows: Row[] = [];
  const bytesCache = new Map<string, Uint8Array>();
  const hashCache = new Map<string, string>();

  for (const entry of plan) {
    const full = join(DIR, entry.relPath);
    let bytes = bytesCache.get(entry.relPath);
    if (!bytes) {
      bytes = new Uint8Array(readFileSync(full));
      bytesCache.set(entry.relPath, bytes);
    }
    let hash = hashCache.get(entry.relPath);
    if (!hash) {
      hash = await sha256Hex(bytes);
      hashCache.set(entry.relPath, hash);
    }

    const base: Row = {
      relPath: entry.relPath,
      status: entry.status as Status,
      target: entry.target,
      accountId: null,
      institutionId: null,
      accountLabel: entry.target ? label(entry.target) : '—',
      date: entry.date?.value ?? '—',
      detail: entry.supersededBy ? `gana ${entry.supersededBy}` : '',
      hash,
      bytes,
    };

    if (entry.status === 'SIN_RUTEO' || entry.status === 'DUP_LOCAL') {
      rows.push(base);
      continue;
    }

    const target = entry.target;
    if (!target) {
      rows.push({ ...base, status: 'SIN_RUTEO' });
      continue;
    }

    const acct = accountRows.find((a) => accountMatches(a, target));
    if (!acct) {
      rows.push({ ...base, status: 'SIN_CUENTA', detail: 'no existe la cuenta en la app' });
      continue;
    }

    if (knownHashes.has(hash)) {
      rows.push({ ...base, status: 'YA_CARGADO', accountId: acct.id, institutionId: acct.institutionId });
      continue;
    }

    // Verificación por contenido (best-effort, sin LLM).
    const conflict = entry.relPath.toLowerCase().endsWith('.pdf')
      ? contentConflict(await firstPageText(bytes), target)
      : null;
    if (conflict) {
      rows.push({ ...base, status: 'CONFLICTO', accountId: acct.id, institutionId: acct.institutionId, detail: conflict });
      continue;
    }

    // Período solapado con un import ya cargado de esa cuenta.
    if (entry.date?.precision === 'day' && !FORCE) {
      const near = (periodsByAccount.get(acct.id) ?? []).find(
        (p) => daysBetween(p, entry.date!.value) <= PERIOD_OVERLAP_DAYS,
      );
      if (near) {
        rows.push({
          ...base,
          status: 'POSIBLE_DUP',
          accountId: acct.id,
          institutionId: acct.institutionId,
          detail: `ya hay un import de esta cuenta con period_end ${near}`,
        });
        continue;
      }
    }

    rows.push({ ...base, accountId: acct.id, institutionId: acct.institutionId });
  }

  printTable(rows);

  const toUpload = rows.filter((r) => UPLOADABLE.has(r.status) && r.accountId && r.institutionId);
  const capped = LIMIT > 0 ? toUpload.slice(0, LIMIT) : toUpload;

  if (DRY_RUN) {
    console.warn(`\n[bulk] DRY RUN — no se subió nada. Subiría ${capped.length} archivo(s).`);
    return;
  }

  console.warn(`\n[bulk] subiendo ${capped.length} archivo(s)…`);
  let ok = 0;
  let failed = 0;
  for (const [i, row] of capped.entries()) {
    const tag = `${i + 1}/${capped.length} ${row.relPath}`;
    const created = await createImportInternal({
      householdId: household.id,
      userId: null,
      file: {
        name: basename(row.relPath),
        bytes: row.bytes!,
        contentType: contentTypeForExt(extractExtension(row.relPath) ?? ''),
      },
      type: row.target!.importType,
      institutionId: row.institutionId!,
      accountId: row.accountId!,
    });

    if (!created.ok) {
      failed++;
      console.warn(`[bulk] ✖ ${tag} — create: ${created.error}`);
      continue;
    }

    const parsed = await parseImportInternal(created.importId, household.id);
    if (parsed.ok) {
      ok++;
      console.warn(`[bulk] ✔ ${tag} — ${parsed.lineCount} líneas (${created.importId.slice(0, 8)})`);
    } else {
      failed++;
      console.warn(`[bulk] ⚠ ${tag} — subido pero el parseo falló: ${parsed.error} (${created.importId.slice(0, 8)})`);
    }
  }

  console.warn(`\n[bulk] listo — ${ok} parseados, ${failed} con problema.`);
  console.warn('[bulk] NADA fue confirmado: revisá y confirmá en /imports.');
}

function printTable(rows: readonly Row[]): void {
  const order: Status[] = [
    'NUEVO',
    'SIN_FECHA',
    'POSIBLE_DUP',
    'CONFLICTO',
    'SIN_CUENTA',
    'SIN_RUTEO',
    'DUP_LOCAL',
    'YA_CARGADO',
  ];
  const counts = new Map<Status, number>();
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);

  console.warn('\n=== PLAN DE CARGA ===');
  for (const s of order) {
    const n = counts.get(s) ?? 0;
    if (n > 0) console.warn(`  ${s.padEnd(12)} ${n}`);
  }

  for (const s of order) {
    const group = rows.filter((r) => r.status === s);
    if (group.length === 0 || s === 'YA_CARGADO' || s === 'DUP_LOCAL') continue;
    console.warn(`\n--- ${s} ---`);
    for (const r of group) {
      const extra = r.detail ? `  (${r.detail})` : '';
      console.warn(`  ${r.date.padEnd(10)} ${r.accountLabel.padEnd(46)} ${r.relPath}${extra}`);
    }
  }
  console.warn(
    `\n(YA_CARGADO y DUP_LOCAL se omiten del detalle: son ${(counts.get('YA_CARGADO') ?? 0) + (counts.get('DUP_LOCAL') ?? 0)} archivos que no se tocan.)`,
  );
}

main().catch((err: unknown) => {
  console.error('[bulk] falló:', err);
  process.exit(1);
});
