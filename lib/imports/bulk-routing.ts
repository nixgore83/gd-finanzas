import type { ImportType } from '@/lib/schemas/import';
import type { ACCOUNT_TYPES, CARD_BRANDS, CURRENCIES, OWNER_TAGS } from '@/lib/schemas/account';

/**
 * Ruteo y deduplicación de una carga masiva de extractos desde una carpeta.
 *
 * Por qué existe: la carpeta de Drive tiene 142 archivos para ~50 resúmenes reales.
 * El mismo resumen aparece re-descargado 2-3 veces con BYTES DISTINTOS (sufijos
 * " (1)", " (2)") y a veces bajo dos convenciones de nombre del mismo banco. El
 * dedup por `file_hash` de `createImportInternal` NO los agarra, así que subir la
 * carpeta cruda cargaría cada mes 2-3 veces — exactamente los duplicados que se
 * limpiaron a mano en junio/julio 2026 (ver STATUS.md).
 *
 * La defensa es dedupear por `(cuenta destino, fecha de cierre)`, que se derivan
 * del path + nombre del archivo sin abrir el PDF ni gastar un token de LLM.
 *
 * Todo acá es PURO: recibe paths relativos y devuelve descriptores. Resolver un
 * descriptor a un `account_id` concreto es trabajo del script, contra la DB.
 */

type AccountType = (typeof ACCOUNT_TYPES)[number];
type CardBrand = (typeof CARD_BRANDS)[number];
type Currency = (typeof CURRENCIES)[number];
type OwnerTag = (typeof OWNER_TAGS)[number];

/**
 * Cuenta destino descrita por sus atributos, no por su UUID. El script la
 * resuelve contra `accounts` — así las reglas se testean sin DB y no hay UUIDs
 * hardcodeados que se pudran cuando se recrea una cuenta.
 */
export type RouteTarget = {
  institutionName: string;
  importType: ImportType;
  ownerTag: OwnerTag;
  accountType: AccountType;
  currency: Currency;
  cardBrand?: CardBrand;
  /**
   * Sufijo identificatorio de la cuenta dentro de la institución (ICBC usa los
   * últimos 4 del nro de cuenta; BIND usa el sufijo "/2", "/3" de la sub-cuenta
   * dentro del resumen consolidado). Desambigua cuando institución+tipo+moneda
   * no alcanzan.
   */
  accountHint?: string;
};

/** Fecha del extracto derivada del nombre del archivo. */
export type StatementDate =
  | { precision: 'day'; value: string } // YYYY-MM-DD
  | { precision: 'month'; value: string }; // YYYY-MM

export type RouteRule = {
  /** Nombre legible de la regla — aparece en la tabla del dry-run. */
  id: string;
  /** Path relativo, con "/" y ya normalizado a minúsculas. */
  match: (relPath: string) => boolean;
  /**
   * Carpeta donde DEBERÍA vivir el archivo. Las carpetas de origen mezclan
   * cuentas distintas (dos Visas de Pau de dos bancos en "TC/Visa Pau"; los
   * extractos de Nico dentro de "Pau"), así que la carpeta sola no alcanza para
   * saber de quién es un archivo. `scripts/organize-statements.ts` usa esto para
   * dejar la carpeta reflejando la realidad; el ruteo del import NO depende de
   * que el archivo ya esté movido.
   */
  folder: string;
  /**
   * Un archivo puede mapear a MÁS DE UNA cuenta: el resumen BIND "Cuentas
   * bantotal" es consolidado y cubre la sub-cuenta en ARS y la de USD en el
   * mismo PDF. En ese caso se sube una vez por cuenta y cada parseo se acota a
   * su sub-cuenta.
   */
  targets: RouteTarget[];
};

const MESES: Record<string, string> = {
  ene: '01', enero: '01', jan: '01',
  feb: '02', febrero: '02',
  mar: '03', marzo: '03',
  abr: '04', abril: '04', apr: '04',
  may: '05', mayo: '05',
  jun: '06', junio: '06',
  jul: '07', julio: '07',
  ago: '08', agosto: '08', aug: '08',
  sep: '09', septiembre: '09', set: '09',
  oct: '10', octubre: '10',
  nov: '11', noviembre: '11',
  dic: '12', diciembre: '12', dec: '12',
};

function pad2(n: string | number): string {
  return String(n).padStart(2, '0');
}

/** Valida que el trío sea una fecha real (rechaza 31/02, mes 13, etc.). */
function isoDate(y: string, m: string, d: string): string | null {
  const yy = Number(y);
  const mm = Number(m);
  const dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const probe = new Date(Date.UTC(yy, mm - 1, dd));
  if (probe.getUTCMonth() !== mm - 1 || probe.getUTCDate() !== dd) return null;
  return `${yy}-${pad2(mm)}-${pad2(dd)}`;
}

function isoMonth(y: string, m: string): string | null {
  const mm = Number(m);
  if (mm < 1 || mm > 12) return null;
  return `${Number(y)}-${pad2(mm)}`;
}

/**
 * Extrae la fecha del extracto del NOMBRE del archivo. Cubre las convenciones
 * que aparecen en la carpeta; devuelve `null` cuando el nombre no la trae (ej.
 * los BNA `8610_1040211953.pdf` o los `ERESUMEN VISA.PDF`), en cuyo caso el
 * archivo no se puede dedupear por período y el dry-run lo marca.
 *
 * El sufijo de copia (" (2)") se ignora: es justamente lo que hace que dos
 * copias del mismo resumen tengan nombres distintos.
 */
export function extractStatementDate(fileName: string): StatementDate | null {
  // Sin extensión ni sufijo de copia " (2)".
  const base = fileName
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\s*\(\d+\)\s*$/g, '')
    .replace(/\s*\(\d+\)\s*/g, ' ')
    .trim();

  // 1) YYYYMMDD compacto: "27288643119_Visa_20260723", "..._bantotal_20260630"
  const compact = /(?:^|[^\d])(20\d{2})(\d{2})(\d{2})(?:[^\d]|$)/.exec(base);
  if (compact?.[1] && compact[2] && compact[3]) {
    const d = isoDate(compact[1], compact[2], compact[3]);
    if (d) return { precision: 'day', value: d };
  }

  // 2) YYYY-MM-DD: "2026-01-27_Statement", "Caja de ahorro-2026-05-22"
  const ymd = /(20\d{2})-(\d{1,2})-(\d{1,2})(?:[^\d]|$)/.exec(base);
  if (ymd?.[1] && ymd[2] && ymd[3]) {
    const d = isoDate(ymd[1], ymd[2], ymd[3]);
    if (d) return { precision: 'day', value: d };
  }

  // 3) DD-MM-YYYY: "CAJA DE AHORRO 02-07-2026"
  const dmy = /(?:^|[^\d])(\d{1,2})-(\d{1,2})-(20\d{2})(?:[^\d]|$)/.exec(base);
  if (dmy?.[1] && dmy[2] && dmy[3]) {
    const d = isoDate(dmy[3], dmy[2], dmy[1]);
    if (d) return { precision: 'day', value: d };
  }

  // 4) Galicia: "RESUMEN_VISA23_7_2026pdf" → cierre 23/07/2026.
  //    El "pdf" pegado al año es parte del nombre que manda el banco.
  const galicia = /RESUMEN_[A-Z]+(\d{1,2})_(\d{1,2})_(20\d{2})/i.exec(base);
  if (galicia?.[1] && galicia[2] && galicia[3]) {
    const d = isoDate(galicia[3], galicia[2], galicia[1]);
    if (d) return { precision: 'day', value: d };
  }

  // 5) Mes con nombre: "resumen_cuenta_visa_Jul_2026", "Resumen_MercadoPago_Junio2026"
  const named = /([a-záéíóú]{3,10})[_\s]*(20\d{2})(?:[^\d]|$)/i.exec(base);
  if (named?.[1] && named[2]) {
    const m = MESES[named[1].toLowerCase()];
    if (m) {
      const v = isoMonth(named[2], m);
      if (v) return { precision: 'month', value: v };
    }
  }

  // 6) YYYY-MM o "YYYY MM": "2026-01", "Amex galicia 2026 06"
  const ym = /(20\d{2})[-\s](\d{1,2})(?:[^\d]|$)/.exec(base);
  if (ym?.[1] && ym[2]) {
    const v = isoMonth(ym[1], ym[2]);
    if (v) return { precision: 'month', value: v };
  }

  // 7) MM-YY al principio: "01-26 EXT.DE.MOVIMIENTOS-5727"
  const myShort = /^(\d{2})-(\d{2})[\s_]/.exec(base);
  if (myShort?.[1] && myShort[2]) {
    const v = isoMonth(`20${myShort[2]}`, myShort[1]);
    if (v) return { precision: 'month', value: v };
  }

  return null;
}

const GALICIA = 'Galicia';
const BIND = 'Banco Industrial';
const ICBC = 'ICBC';

function tcTarget(
  institutionName: string,
  ownerTag: OwnerTag,
  cardBrand: CardBrand,
  currency: Currency = 'ARS',
): RouteTarget {
  return {
    institutionName,
    importType: 'tc',
    ownerTag,
    accountType: 'credit_card',
    currency,
    cardBrand,
  };
}

/** `p` ya viene en minúsculas y con "/" como separador. */
const startsWith = (prefix: string) => (p: string) => p.startsWith(prefix.toLowerCase());
const inFolder = (folder: string, filePattern: RegExp) => (p: string) => {
  if (!p.startsWith(folder.toLowerCase())) return false;
  const file = p.slice(p.lastIndexOf('/') + 1);
  return filePattern.test(file);
};
/** Matchea si CUALQUIERA de los matchers matchea. */
const anyOf =
  (...matchers: Array<(p: string) => boolean>) =>
  (p: string) =>
    matchers.some((m) => m(p));

/**
 * Una regla de carpeta mixta tiene que reconocer DOS ubicaciones: la original
 * (mezclada, ej. "TC/Visa Pau") y la canónica a la que `organize-statements` la
 * mueve (ej. "TC/Visa BIND Pau"). Sin esto, reorganizar la carpeta dejaba los
 * archivos sin ruteo y el import no los encontraba — la reorganización rompía
 * justamente lo que venía a ordenar.
 */
const inFolderOrCanonical = (
  sourceFolder: string,
  filePattern: RegExp,
  canonicalFolder: string,
) => anyOf(inFolder(sourceFolder, filePattern), startsWith(`${canonicalFolder}/`));

/**
 * Reglas en orden: la PRIMERA que matchea gana. Las carpetas mixtas
 * (`tc/visa pau`, `pau`) van desambiguadas por patrón de nombre, así que sus
 * reglas específicas tienen que ir antes que cualquier regla de carpeta.
 */
export const ROUTE_RULES: RouteRule[] = [
  // --- Carpetas mixtas: Visa de Pau son DOS tarjetas de dos bancos distintos.
  // Verificado abriendo los PDFs: RESUMEN_VISA* dice "galicia"; 27288643119_*
  // es Banco Industrial (www.bind.com.ar / pagoslink.com.ar).
  {
    id: 'pau-visa-galicia',
    folder: 'TC/Visa Galicia Pau',
    match: inFolderOrCanonical('tc/visa pau/', /^resumen_visa/i, 'tc/visa galicia pau'),
    targets: [tcTarget(GALICIA, 'Pau', 'visa')],
  },
  {
    // El portal de BIND nombra los archivos "<CUIL>_<producto>_<YYYYMMDD>". Se
    // matchea el CUIL como \d{11} a propósito: un CUIL real no va en el repo.
    id: 'pau-visa-bind',
    folder: 'TC/Visa BIND Pau',
    match: inFolderOrCanonical('tc/visa pau/', /^\d{11}_visa/i, 'tc/visa bind pau'),
    targets: [tcTarget(BIND, 'Pau', 'visa')],
  },
  {
    id: 'pau-visa-galicia-dup',
    folder: 'TC/Visa Galicia Pau',
    match: inFolderOrCanonical('pau/', /^resumen_visa/i, 'tc/visa galicia pau'),
    targets: [tcTarget(GALICIA, 'Pau', 'visa')],
  },
  {
    id: 'pau-visa-bind-dup',
    folder: 'TC/Visa BIND Pau',
    match: inFolderOrCanonical('pau/', /^\d{11}_visa/i, 'tc/visa bind pau'),
    targets: [tcTarget(BIND, 'Pau', 'visa')],
  },
  {
    // Resumen CONSOLIDADO de BIND: un PDF cubre la sub-cuenta ARS y la USD.
    // La sub-cuenta EUR existe pero está "SIN MOVIMIENTOS", así que no se modela.
    id: 'pau-bind-cuentas',
    folder: 'Cuentas/BIND Pau',
    match: inFolderOrCanonical('pau/', /^\d{11}_cuentas bantotal/i, 'cuentas/bind pau'),
    targets: [
      {
        institutionName: BIND,
        importType: 'banco',
        ownerTag: 'Pau',
        accountType: 'bank_savings',
        currency: 'ARS',
        accountHint: '/3',
      },
      {
        institutionName: BIND,
        importType: 'banco',
        ownerTag: 'Pau',
        accountType: 'bank_savings',
        currency: 'USD',
        accountHint: '/2',
      },
    ],
  },
  {
    // "CAJA DE AHORRO DD-MM-YYYY" → titular NICOLAS GORE (verificado en el PDF),
    // pese a vivir en la carpeta "Pau". La verificación por contenido del script
    // vuelve a chequear el titular antes de subir.
    id: 'nico-galicia-ca-consolidado',
    folder: 'Cuentas/Galicia Nico',
    match: inFolderOrCanonical('pau/', /^resumen_extractos consolidados - caja de ahorro \d{2}-\d{2}-\d{4}/i, 'cuentas/galicia nico'),
    targets: [
      {
        institutionName: GALICIA,
        importType: 'banco',
        ownerTag: 'Nico',
        accountType: 'bank_savings',
        currency: 'ARS',
      },
    ],
  },
  {
    // "Caja de ahorro-YYYY-MM-DD" → titular PAULA DALMASSO (verificado).
    id: 'pau-galicia-ca',
    folder: 'Cuentas/Galicia Pau',
    match: inFolderOrCanonical('pau/', /^resumen_extractos consolidados - caja de ahorro-\d{4}-\d{2}-\d{2}/i, 'cuentas/galicia pau'),
    targets: [
      {
        institutionName: GALICIA,
        importType: 'banco',
        ownerTag: 'Pau',
        accountType: 'bank_savings',
        currency: 'ARS',
      },
    ],
  },

  // --- Tarjetas de Nico, una carpeta por tarjeta.
  {
    id: 'nico-visa-icbc',
    folder: 'TC/Visa ICBC',
    match: startsWith('tc/visa icbc/'),
    targets: [tcTarget(ICBC, 'Nico', 'visa')],
  },
  {
    id: 'nico-master-icbc',
    folder: 'TC/Master ICBC',
    match: startsWith('tc/master icbc/'),
    targets: [tcTarget(ICBC, 'Nico', 'master')],
  },
  {
    id: 'nico-amex-galicia',
    folder: 'TC/Amex Galicia',
    match: startsWith('tc/amex galicia/'),
    targets: [tcTarget(GALICIA, 'Nico', 'amex')],
  },
  {
    id: 'nico-master-galicia',
    folder: 'TC/Master Galicia',
    match: startsWith('tc/master galicia/'),
    targets: [tcTarget(GALICIA, 'Nico', 'master')],
  },
  {
    id: 'nico-visa-galicia',
    folder: 'TC/Visa Galicia',
    match: startsWith('tc/visa galicia/'),
    targets: [tcTarget(GALICIA, 'Nico', 'visa')],
  },
  {
    id: 'nico-visa-bna',
    folder: 'TC/Visa BNA',
    match: startsWith('tc/visa bna/'),
    targets: [tcTarget('BNA', 'Nico', 'visa')],
  },
  {
    id: 'nico-master-hsbc',
    folder: 'TC/Master HSBC Us',
    match: startsWith('tc/master hsbc us/'),
    targets: [tcTarget('HSBC US', 'Nico', 'master', 'USD')],
  },
  {
    id: 'nico-mp-tc',
    folder: 'TC/MercadoPago',
    match: startsWith('tc/mercadopago/'),
    targets: [tcTarget('Mercado Pago', 'Nico', 'master')],
  },

  // --- Cuentas bancarias de Nico. ICBC se desambigua por el sufijo del nro de
  // cuenta que el propio banco pone en el nombre del archivo.
  {
    id: 'nico-icbc-cc-5727',
    folder: 'Cuentas/ICBC',
    match: inFolder('cuentas/icbc/', /5727/),
    targets: [
      {
        institutionName: ICBC,
        importType: 'banco',
        ownerTag: 'Nico',
        accountType: 'bank_checking',
        currency: 'ARS',
        accountHint: '5727',
      },
    ],
  },
  {
    id: 'nico-icbc-ca-ars-9430',
    folder: 'Cuentas/ICBC',
    match: inFolder('cuentas/icbc/', /9430|0926/),
    targets: [
      {
        institutionName: ICBC,
        importType: 'banco',
        ownerTag: 'Nico',
        accountType: 'bank_savings',
        currency: 'ARS',
        accountHint: '0926',
      },
    ],
  },
  {
    id: 'nico-icbc-ca-usd-0413',
    folder: 'Cuentas/ICBC',
    match: inFolder('cuentas/icbc/', /0413/),
    targets: [
      {
        institutionName: ICBC,
        importType: 'banco',
        ownerTag: 'Nico',
        accountType: 'bank_savings',
        currency: 'USD',
        accountHint: '0413',
      },
    ],
  },
  {
    id: 'nico-hsbc-checking',
    folder: 'Cuentas/Hsbc US',
    match: startsWith('cuentas/hsbc us/'),
    targets: [
      {
        institutionName: 'HSBC US',
        importType: 'banco',
        ownerTag: 'Nico',
        accountType: 'bank_checking',
        currency: 'USD',
      },
    ],
  },
  {
    id: 'nico-icbc-ca-ars-csv',
    folder: 'Cuentas/ICBC',
    match: inFolder('cuentas/', /^movimientos-icbc ca 0926/i),
    targets: [
      {
        institutionName: ICBC,
        importType: 'banco',
        ownerTag: 'Nico',
        accountType: 'bank_savings',
        currency: 'ARS',
        accountHint: '0926',
      },
    ],
  },
];

/** Normaliza a "/" y minúsculas para que las reglas no dependan del SO. */
export function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/').toLowerCase();
}

export function routeFile(relPath: string): RouteRule | null {
  const p = normalizeRelPath(relPath);
  return ROUTE_RULES.find((r) => r.match(p)) ?? null;
}

/**
 * ¿El `account_number` guardado en la cuenta corresponde al `accountHint` de la
 * regla? Hay DOS convenciones distintas y confundirlas rutea plata a la cuenta
 * equivocada:
 *
 *  - Hint que empieza con "/" (BIND): es el sufijo de sub-cuenta dentro de un
 *    resumen consolidado ("743449/3"). Tiene que matchear como SUFIJO EXACTO —
 *    comparar sólo dígitos daría falsos positivos, porque "7434492" contiene un
 *    "3" en el medio y matchearía la sub-cuenta equivocada.
 *  - Hint numérico (ICBC): son los últimos dígitos que el banco pone en el
 *    NOMBRE del archivo ("EXT.DE.MOVIMIENTOS-5727"), mientras que la cuenta
 *    guarda el número formateado con barras ("0905/02100757/27"). Ahí hay que
 *    comparar ignorando los separadores: "09050210075727" sí termina en "5727".
 */
export function accountNumberMatchesHint(
  accountNumber: string | null | undefined,
  hint: string,
): boolean {
  const raw = (accountNumber ?? '').trim();
  if (!raw || !hint) return false;
  if (hint.startsWith('/')) return raw.endsWith(hint);
  const digitsOnly = raw.replace(/\D/g, '');
  const hintDigits = hint.replace(/\D/g, '');
  if (!hintDigits) return false;
  return digitsOnly.includes(hintDigits);
}

/** Clave de identidad de un resumen: misma cuenta + misma fecha ⇒ mismo resumen. */
export function statementKey(target: RouteTarget, date: StatementDate): string {
  const acct = [
    target.institutionName,
    target.ownerTag,
    target.accountType,
    target.currency,
    target.cardBrand ?? '',
    target.accountHint ?? '',
  ].join('|');
  return `${acct}@${date.precision}:${date.value}`;
}

/**
 * Entre varias copias locales del MISMO resumen, cuál subir. Prefiere el nombre
 * sin sufijo de copia (" (2)"), después el más corto, y desempata alfabético
 * para que la elección sea determinística corrida a corrida.
 */
export function preferredCopy(paths: readonly string[]): string | null {
  if (paths.length === 0) return null;
  const score = (p: string): [number, number, string] => {
    const file = p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
    return [/\(\d+\)/.test(file) ? 1 : 0, file.length, file];
  };
  return [...paths].sort((a, b) => {
    const [ca, la, na] = score(a);
    const [cb, lb, nb] = score(b);
    return ca - cb || la - lb || na.localeCompare(nb);
  })[0]!;
}

export type PlannedFile = {
  relPath: string;
  rule: RouteRule | null;
  date: StatementDate | null;
};

export type PlanEntry = {
  relPath: string;
  ruleId: string | null;
  target: RouteTarget | null;
  date: StatementDate | null;
  status: 'NUEVO' | 'DUP_LOCAL' | 'SIN_RUTEO' | 'SIN_FECHA';
  /** Copia elegida cuando este archivo se descartó por `DUP_LOCAL`. */
  supersededBy?: string;
};

/**
 * Arma el plan de carga a partir de los archivos encontrados, resolviendo los
 * duplicados LOCALES. No sabe nada de la DB: el estado `YA_CARGADO` y el aviso
 * de período solapado los agrega el script, que sí la consulta.
 *
 * Un archivo con varias cuentas destino (consolidado BIND) genera una entrada
 * por cuenta.
 */
export function buildPlan(files: readonly PlannedFile[]): PlanEntry[] {
  // Agrupar por resumen: clave (cuenta, fecha). Sólo entran los ruteados y fechados.
  const groups = new Map<string, { paths: string[] }>();
  for (const f of files) {
    if (!f.rule || !f.date) continue;
    for (const target of f.rule.targets) {
      const key = statementKey(target, f.date);
      const g = groups.get(key) ?? { paths: [] };
      if (!g.paths.includes(f.relPath)) g.paths.push(f.relPath);
      groups.set(key, g);
    }
  }

  const winners = new Map<string, string>();
  for (const [key, g] of groups) {
    const win = preferredCopy(g.paths);
    if (win) winners.set(key, win);
  }

  const out: PlanEntry[] = [];
  for (const f of files) {
    if (!f.rule) {
      out.push({ relPath: f.relPath, ruleId: null, target: null, date: f.date, status: 'SIN_RUTEO' });
      continue;
    }
    if (!f.date) {
      for (const target of f.rule.targets) {
        out.push({
          relPath: f.relPath,
          ruleId: f.rule.id,
          target,
          date: null,
          status: 'SIN_FECHA',
        });
      }
      continue;
    }
    for (const target of f.rule.targets) {
      const key = statementKey(target, f.date);
      const winner = winners.get(key);
      const isWinner = winner === f.relPath;
      out.push({
        relPath: f.relPath,
        ruleId: f.rule.id,
        target,
        date: f.date,
        status: isWinner ? 'NUEVO' : 'DUP_LOCAL',
        ...(isWinner ? {} : { supersededBy: winner }),
      });
    }
  }
  return out;
}
