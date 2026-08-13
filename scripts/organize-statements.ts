import {
  readdirSync,
  mkdirSync,
  renameSync,
  rmdirSync,
  statSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import {
  buildPlan,
  extractStatementDate,
  routeFile,
  type PlannedFile,
} from '../lib/imports/bulk-routing';

/**
 * Deja la carpeta de extractos reflejando de qué cuenta es cada archivo.
 *
 * Por qué existe: las carpetas mienten. "TC/Visa Pau" mezcla DOS tarjetas de dos
 * bancos distintos (Galicia y Banco Industrial), y "Pau" contiene extractos que
 * en realidad son de Nico. Además el mismo resumen aparece re-descargado 2-3
 * veces. Con las carpetas ordenadas, el archivo se puede encontrar a ojo y la
 * próxima carga no depende de recordar cuál era cuál.
 *
 * Reglas de seguridad, deliberadas:
 *  - Por defecto NO toca nada: hay que pasar `--apply`.
 *  - NUNCA borra. Las copias sobrantes se MUEVEN a `_duplicados/`.
 *  - Nunca pisa un archivo existente: si el destino está ocupado por un archivo
 *    con OTRO contenido, se reporta el choque y se saltea.
 *  - Lo que no matchea ninguna regla se deja donde está y se reporta.
 *
 * Uso:
 *   npm run imports:organize -- --dir "<carpeta>"            (dry-run)
 *   npm run imports:organize -- --dir "<carpeta>" --apply
 */

const FLAGS = process.argv.slice(2);
const DIR = (() => {
  const i = FLAGS.indexOf('--dir');
  return i >= 0 ? (FLAGS[i + 1] ?? null) : null;
})();
const APPLY = FLAGS.includes('--apply');
/** Deja los duplicados donde están en vez de juntarlos en `_duplicados/`. */
const KEEP_DUPES = FLAGS.includes('--keep-duplicates');

const DUPES_FOLDER = '_duplicados';

type Move = {
  from: string;
  to: string;
  reason: 'ruteo' | 'duplicado';
};

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === DUPES_FOLDER) continue; // ya procesado en una corrida previa
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(pdf|csv|xlsx)$/i.test(entry)) acc.push(full);
  }
  return acc;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Primer nombre libre en `folder` a partir de `file`: "x.pdf" → "x (copia 2).pdf". */
function freeName(folder: string, file: string): string {
  const dot = file.lastIndexOf('.');
  const stem = dot === -1 ? file : file.slice(0, dot);
  const ext = dot === -1 ? '' : file.slice(dot);
  let candidate = join(folder, file);
  let n = 2;
  while (existsSync(candidate)) {
    candidate = join(folder, `${stem} (copia ${n})${ext}`);
    n++;
  }
  return candidate;
}

/**
 * Borra las carpetas que quedaron SIN NADA adentro tras los movimientos. Es la
 * única eliminación que hace el script y no puede perder datos: una carpeta
 * vacía no tiene archivos. Nunca toca la raíz.
 */
function pruneEmptyDirs(root: string, current: string = root, out: string[] = []): string[] {
  for (const entry of readdirSync(current)) {
    const full = join(current, entry);
    if (statSync(full).isDirectory()) pruneEmptyDirs(root, full, out);
  }
  if (current !== root && readdirSync(current).length === 0) {
    rmdirSync(current);
    out.push(relative(root, current));
  }
  return out;
}

function main(): void {
  if (!DIR) throw new Error('Falta --dir "<carpeta>"');

  const files = walk(DIR);
  const planned: PlannedFile[] = files.map((full) => {
    const rel = relative(DIR, full);
    return { relPath: rel, rule: routeFile(rel), date: extractStatementDate(basename(rel)) };
  });
  const plan = buildPlan(planned);

  // Una entrada por archivo: `buildPlan` emite una por cuenta destino, pero el
  // archivo físico es uno solo. Se queda con el mejor estado de cada archivo
  // (NUEVO gana sobre DUP_LOCAL: si sirve para alguna cuenta, no es descarte).
  const byFile = new Map<string, (typeof plan)[number]>();
  for (const e of plan) {
    const prev = byFile.get(e.relPath);
    if (!prev || (prev.status === 'DUP_LOCAL' && e.status !== 'DUP_LOCAL')) {
      byFile.set(e.relPath, e);
    }
  }

  const moves: Move[] = [];
  const sinRuteo: string[] = [];

  for (const [rel, entry] of byFile) {
    const rule = planned.find((p) => p.relPath === rel)?.rule;
    if (!rule) {
      sinRuteo.push(rel);
      continue;
    }

    const file = basename(rel);
    const esDuplicado = entry.status === 'DUP_LOCAL' && !KEEP_DUPES;
    const destFolder = esDuplicado ? join(DUPES_FOLDER, rule.folder) : rule.folder;
    const destRel = join(destFolder, file);

    if (destRel === rel) continue; // ya está donde va

    moves.push({
      from: rel,
      to: destRel,
      reason: esDuplicado ? 'duplicado' : 'ruteo',
    });
  }

  // ── Reporte ────────────────────────────────────────────────────────────────
  const ruteo = moves.filter((m) => m.reason === 'ruteo');
  const dupes = moves.filter((m) => m.reason === 'duplicado');

  console.warn(`\n=== REORGANIZACIÓN ${APPLY ? '(APLICANDO)' : '(DRY RUN — no se mueve nada)'} ===`);
  console.warn(`archivos: ${files.length}  |  a mover: ${moves.length}  |  ya en su lugar: ${files.length - moves.length - sinRuteo.length}`);

  if (ruteo.length > 0) {
    console.warn(`\n--- ${ruteo.length} archivo(s) mal ubicados ---`);
    const porDestino = new Map<string, Move[]>();
    for (const m of ruteo) {
      const d = dirname(m.to);
      porDestino.set(d, [...(porDestino.get(d) ?? []), m]);
    }
    for (const [dest, ms] of [...porDestino].sort()) {
      console.warn(`\n  → ${dest}  (${ms.length})`);
      for (const m of ms) console.warn(`      ${m.from}`);
    }
  }

  if (dupes.length > 0) {
    console.warn(`\n--- ${dupes.length} copia(s) sobrante(s) → ${DUPES_FOLDER}/ (no se borra nada) ---`);
    for (const m of dupes) console.warn(`      ${m.from}`);
  }

  if (sinRuteo.length > 0) {
    console.warn(`\n--- ${sinRuteo.length} sin regla (se dejan donde están) ---`);
    for (const f of sinRuteo) console.warn(`      ${f}`);
  }

  if (!APPLY) {
    console.warn('\n[organize] DRY RUN. Volvé a correr con --apply para mover.');
    return;
  }

  // ── Aplicar ────────────────────────────────────────────────────────────────
  let moved = 0;
  let skipped = 0;
  for (const m of moves) {
    const from = join(DIR, m.from);
    const to = join(DIR, m.to);

    let dest = to;
    if (existsSync(to)) {
      if (sha256(from) !== sha256(to)) {
        // Choque real: dos archivos distintos con el mismo nombre. No se pisa.
        console.warn(`[organize] ✖ CHOQUE (destino ocupado con otro contenido): ${m.to}`);
        skipped++;
        continue;
      }
      // Mismo contenido: el archivo es redundante, pero NO se borra. Se guarda
      // junto al que ya está, con un nombre libre, para que la carpeta de origen
      // quede limpia sin perder nada.
      //
      // Ojo: `to` YA apunta a `_duplicados/...` cuando el archivo venía marcado
      // como copia sobrante. Volver a anteponer DUPES_FOLDER acá generaba
      // `_duplicados/_duplicados/...` (bug real, visto en la primera corrida).
      dest = freeName(dirname(to), basename(to));
    }

    mkdirSync(dirname(dest), { recursive: true });
    renameSync(from, dest);
    moved++;
  }

  const vaciadas = pruneEmptyDirs(DIR);

  console.warn(`\n[organize] listo — ${moved} movidos, ${skipped} salteados. Ningún archivo borrado.`);
  if (vaciadas.length > 0) {
    console.warn(`[organize] carpetas vacías eliminadas: ${vaciadas.join(', ')}`);
  }
}

try {
  main();
} catch (err) {
  console.error('[organize] falló:', err);
  process.exit(1);
}
