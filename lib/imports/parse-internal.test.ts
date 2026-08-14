import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accounts, importLines, imports, institutions } from '@/db/schema';
import type { Parser, ParserOutput } from '@/lib/imports/parsers/types';
import { parserOutputSchema } from '@/lib/imports/parsers/types';
import { PARSE_CLAIM_STALE_SECONDS, REPARSEABLE_STATUSES } from '@/lib/imports/parse-claim';

/**
 * Regresión del incidente 2026-07-22: tres imports quedaron con EXACTAMENTE el
 * doble de líneas (cada movimiento del resumen duplicado). Causa: dos ejecutores
 * concurrentes del mismo import (doble click en "Parsear pendientes", auto-parse
 * al subir + click manual, cron + usuario) corrían los dos el parseo completo e
 * insertaban cada uno su tanda de `import_lines`. No había ningún lock.
 *
 * Los datos de acá son SINTÉTICOS. Nunca extractos reales.
 *
 * NOTA sobre el doble de prueba de la DB: `FakeDb` reimplementa en JS la semántica
 * del `UPDATE ... WHERE ... RETURNING` condicional de Postgres (la garantía real de
 * atomicidad es de Postgres y no se puede testear sin una DB). Lo que estos tests
 * verifican es el CABLEADO: que el claim se pida donde corresponde, que el perdedor
 * se retire sin insertar, que `parseImport` no se sabotee a sí mismo y que un
 * `parsing` colgado se pueda reclamar. La FORMA del SQL del claim se testea aparte,
 * contra el dialecto real de drizzle, en `parse-claim.test.ts`.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  downloadImportFile: vi.fn(),
  resolveParser: vi.fn(),
  suggestCategoryForDescription: vi.fn(),
  requireHouseholdSession: vi.fn(),
  afterCallbacks: [] as Array<() => Promise<void>>,
}));

vi.mock('@/lib/db/client', () => ({ getDb: mocks.getDb }));
vi.mock('@/lib/imports/storage', () => ({ downloadImportFile: mocks.downloadImportFile }));
vi.mock('@/lib/imports/parsers/registry', () => ({ resolveParser: mocks.resolveParser }));
vi.mock('@/lib/imports/llm', () => ({
  runParser: vi.fn(() => {
    throw new Error('el test no debería llegar al LLM: usa parseCsv determinístico');
  }),
  LlmError: class LlmError extends Error {},
}));
vi.mock('@/lib/imports/category-suggest', () => ({
  suggestCategoryForDescription: mocks.suggestCategoryForDescription,
}));
vi.mock('@/lib/imports/counterparty-suggest', () => ({
  counterpartyHasIdentity: () => false,
  lookupCounterpartyHistory: vi.fn(),
  enrichLineWithHistory: (line: unknown) => line,
}));
vi.mock('@/lib/categories/tree', () => ({ loadCategoryTree: vi.fn(async () => []) }));
vi.mock('@/lib/imports/parsers/category-prompt', () => ({
  buildCategoryPromptBlock: () => '',
}));
vi.mock('@/lib/imports/period', () => ({ computeImportPeriod: vi.fn(async () => ({ start: null, end: null })) }));
vi.mock('@/lib/imports/pdf-decrypt', () => ({ unlockPdfForImport: vi.fn() }));
vi.mock('@/lib/env', () => ({
  getImportParserEnv: () => ({
    IMPORT_PARSER_MODEL_DEFAULT: 'test-model',
    IMPORT_PARSER_MODEL_CHEAP: 'test-model-cheap',
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({
  after: (cb: () => Promise<void>) => {
    mocks.afterCallbacks.push(cb);
  },
}));
vi.mock('@/lib/auth/session', () => ({
  requireHouseholdSession: mocks.requireHouseholdSession,
  SessionError: class SessionError extends Error {},
}));

const { parseImportInternal } = await import('@/lib/imports/parse-internal');
const { drainUploadedImports, parseImport } = await import('@/app/actions/imports/parse');

// ─────────────────────────── doble de prueba de la DB ───────────────────────────

const IMPORT_ID = '11111111-1111-1111-1111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-2222-2222-222222222222';

type FakeImportRow = {
  id: string;
  householdId: string;
  type: 'tc' | 'banco' | 'broker';
  status: string;
  fileUrl: string;
  institutionId: string | null;
  institutionName: string | null;
  pdfPassword: string | null;
  accountPdfPassword: string | null;
  accountId: string | null;
  accountName: string | null;
  accountCurrency: string | null;
  accountOwnerTag: string | null;
  parsingStartedAt: Date | null;
  createdAt: Date;
  errorMessage: string | null;
  // Encabezado del extracto, escrito por el parseo (no forma parte del row inicial).
  statementAccountRef?: string | null;
  statementHolder?: string | null;
};

type FakeLine = {
  importId: string;
  parsedData: { description?: string };
  transactionId: string | null;
};

function makeRow(overrides: Partial<FakeImportRow> = {}): FakeImportRow {
  return {
    id: IMPORT_ID,
    householdId: HOUSEHOLD_ID,
    type: 'tc',
    status: 'uploaded',
    fileUrl: 'household/import.csv',
    institutionId: null,
    institutionName: 'Banco Sintético',
    pdfPassword: null,
    accountPdfPassword: null,
    // null a propósito: evita la query de dedup cross-import contra `transactions`,
    // que no aporta nada a lo que se está testeando acá.
    accountId: null,
    accountName: null,
    accountCurrency: 'ARS',
    accountOwnerTag: null,
    parsingStartedAt: null,
    createdAt: new Date(),
    errorMessage: null,
    ...overrides,
  };
}

class FakeDb {
  lines: FakeLine[] = [];
  insertBatches = 0;

  constructor(public row: FakeImportRow) {}

  /** Espejo en JS del `WHERE` del claim (ver parseClaimWhere). */
  private claimAllowed(): boolean {
    if (!(REPARSEABLE_STATUSES as readonly string[]).includes(this.row.status)) return false;
    if (this.row.status !== 'parsing') return true;
    const started = this.row.parsingStartedAt ?? this.row.createdAt;
    return Date.now() - started.getTime() > PARSE_CLAIM_STALE_SECONDS * 1000;
  }

  select() {
    return new FakeSelect(this);
  }
  update(table: unknown) {
    return new FakeUpdate(this, table);
  }
  delete(table: unknown) {
    return new FakeDelete(this, table);
  }
  insert(table: unknown) {
    return new FakeInsert(this, table);
  }
  async transaction<T>(cb: (tx: FakeDb) => Promise<T>): Promise<T> {
    return cb(this);
  }

  /** Aplica el claim de forma síncrona (como el UPDATE atómico de Postgres). */
  tryClaim(): Array<{ id: string }> {
    if (!this.claimAllowed()) return [];
    this.row.status = 'parsing';
    this.row.parsingStartedAt = new Date();
    this.row.errorMessage = null;
    return [{ id: this.row.id }];
  }
}

class FakeSelect {
  private table: unknown = null;
  constructor(private db: FakeDb) {}
  from(table: unknown) {
    this.table = table;
    return this;
  }
  leftJoin() {
    return this;
  }
  where() {
    return this;
  }
  limit() {
    return this.exec();
  }
  then<T>(resolve: (rows: unknown[]) => T, reject?: (e: unknown) => void) {
    return this.exec().then(resolve, reject);
  }
  private async exec(): Promise<unknown[]> {
    if (this.table === imports) return [{ ...this.db.row }];
    // Única lectura de import_lines en parse-internal: las líneas YA confirmadas.
    if (this.table === importLines) {
      return this.db.lines
        .filter((l) => l.transactionId !== null)
        .map((l) => ({ desc: l.parsedData.description ?? null }));
    }
    return [];
  }
}

class FakeUpdate {
  private values: Record<string, unknown> = {};
  constructor(
    private db: FakeDb,
    private table: unknown,
  ) {}
  set(values: Record<string, unknown>) {
    this.values = values;
    return this;
  }
  where() {
    return this;
  }
  /** El único UPDATE con RETURNING del flujo es el claim. */
  async returning(): Promise<Array<{ id: string }>> {
    if (this.table !== imports || this.values.status !== 'parsing') {
      throw new Error('UPDATE ... RETURNING inesperado en el fake');
    }
    return this.db.tryClaim();
  }
  then<T>(resolve: (rows: unknown[]) => T, reject?: (e: unknown) => void) {
    return this.exec().then(resolve, reject);
  }
  private async exec(): Promise<unknown[]> {
    if (this.table === imports) {
      for (const [k, v] of Object.entries(this.values)) {
        if (v === null || typeof v !== 'object' || v instanceof Date) {
          Object.assign(this.db.row, { [k]: v });
        }
      }
    }
    // accounts / institutions (persistir password): irrelevante acá.
    return [];
  }
}

class FakeDelete {
  constructor(
    private db: FakeDb,
    private table: unknown,
  ) {}
  where() {
    return this;
  }
  then<T>(resolve: (rows: unknown[]) => T, reject?: (e: unknown) => void) {
    return this.exec().then(resolve, reject);
  }
  private async exec(): Promise<unknown[]> {
    if (this.table === importLines) {
      // Espejo del WHERE real: sólo las líneas NO confirmadas.
      this.db.lines = this.db.lines.filter((l) => l.transactionId !== null);
    }
    return [];
  }
}

class FakeInsert {
  private rows: FakeLine[] = [];
  constructor(
    private db: FakeDb,
    private table: unknown,
  ) {}
  values(rows: FakeLine[]) {
    this.rows = rows;
    return this;
  }
  then<T>(resolve: (rows: unknown[]) => T, reject?: (e: unknown) => void) {
    return this.exec().then(resolve, reject);
  }
  private async exec(): Promise<unknown[]> {
    if (this.table === importLines) {
      this.db.insertBatches++;
      for (const r of this.rows) {
        this.db.lines.push({ ...r, transactionId: r.transactionId ?? null });
      }
    }
    return [];
  }
}

// ───────────────────────────── parser sintético ─────────────────────────────

let parseCsvCalls = 0;

function fakeParser(statementAccount?: ParserOutput['statementAccount']): Parser {
  return {
    id: 'fake',
    institutionMatch: () => true,
    importTypeMatch: () => true,
    systemPrompt: 'sys',
    userPrompt: 'usr',
    schema: parserOutputSchema,
    parseCsv: (): ParserOutput => {
      parseCsvCalls++;
      return {
        statementAccount,
        lines: [
          {
            date: '2026-07-01',
            description: 'MOVIMIENTO SINTETICO',
            amountOriginal: '1000.00',
            currencyOriginal: 'ARS',
            kind: 'expense',
            isTransfer: false,
            isRefund: false,
          },
        ],
      };
    },
  };
}

function newDb(overrides: Partial<FakeImportRow> = {}): FakeDb {
  const db = new FakeDb(makeRow(overrides));
  mocks.getDb.mockReturnValue(db);
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  parseCsvCalls = 0;
  mocks.afterCallbacks.length = 0;
  mocks.downloadImportFile.mockResolvedValue(new TextEncoder().encode('csv sintético'));
  mocks.resolveParser.mockReturnValue(fakeParser());
  mocks.suggestCategoryForDescription.mockResolvedValue(null);
  mocks.requireHouseholdSession.mockResolvedValue({ householdId: HOUSEHOLD_ID, userId: 'u1' });
});

// ─────────────────────────────────── tests ───────────────────────────────────

describe('parseImportInternal — claim atómico', () => {
  it('parsea e inserta una sola tanda de líneas en el caso feliz', async () => {
    const db = newDb();

    const res = await parseImportInternal(IMPORT_ID, HOUSEHOLD_ID);

    expect(res).toEqual({ ok: true, lineCount: 1 });
    expect(db.insertBatches).toBe(1);
    expect(db.lines).toHaveLength(1);
    expect(db.row.status).toBe('parsed');
  });

  it('persiste nº de cuenta Y titular del encabezado del extracto', async () => {
    // El titular venía saliendo del parser (`statementAccount.holder`) y se
    // descartaba: sólo se guardaba el número. Ahora los dos van a `imports`
    // para mostrarlos en el detalle. Datos sintéticos.
    mocks.resolveParser.mockReturnValue(
      fakeParser({ number: '0905/02100757/27', holder: 'TITULAR SINTETICO' }),
    );
    const db = newDb();

    await parseImportInternal(IMPORT_ID, HOUSEHOLD_ID);

    expect(db.row.statementAccountRef).toBe('0905/02100757/27');
    expect(db.row.statementHolder).toBe('TITULAR SINTETICO');
  });

  it('extracto sin encabezado legible → nº y titular quedan en null', async () => {
    const db = newDb();

    await parseImportInternal(IMPORT_ID, HOUSEHOLD_ID);

    expect(db.row.statementAccountRef).toBeNull();
    expect(db.row.statementHolder).toBeNull();
  });

  it('REGRESIÓN: dos parseos concurrentes del mismo import → una sola tanda de líneas', async () => {
    const db = newDb();

    const [a, b] = await Promise.all([
      parseImportInternal(IMPORT_ID, HOUSEHOLD_ID),
      parseImportInternal(IMPORT_ID, HOUSEHOLD_ID),
    ]);

    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === 'already_parsing')).toHaveLength(1);

    // Lo que rompía en producción: 2 tandas → 2× líneas.
    expect(db.insertBatches).toBe(1);
    expect(db.lines).toHaveLength(1);
    expect(parseCsvCalls).toBe(1);
  });

  it('el perdedor de la carrera no toca el estado del import', async () => {
    const db = newDb({ status: 'parsing', parsingStartedAt: new Date() });

    const res = await parseImportInternal(IMPORT_ID, HOUSEHOLD_ID);

    expect(res).toEqual({ ok: false, error: 'already_parsing' });
    expect(db.row.status).toBe('parsing');
    expect(db.lines).toHaveLength(0);
    expect(db.insertBatches).toBe(0);
    expect(mocks.downloadImportFile).not.toHaveBeenCalled();
  });

  it('un parsing COLGADO (stale) se puede reclamar y reintentar', async () => {
    const stale = new Date(Date.now() - (PARSE_CLAIM_STALE_SECONDS + 60) * 1000);
    const db = newDb({ status: 'parsing', parsingStartedAt: stale });

    const res = await parseImportInternal(IMPORT_ID, HOUSEHOLD_ID);

    expect(res).toEqual({ ok: true, lineCount: 1 });
    expect(db.row.status).toBe('parsed');
    expect(db.lines).toHaveLength(1);
  });

  it('un parsing colgado SIN parsing_started_at cae al created_at', async () => {
    const old = new Date(Date.now() - (PARSE_CLAIM_STALE_SECONDS + 60) * 1000);
    const db = newDb({ status: 'parsing', parsingStartedAt: null, createdAt: old });

    const res = await parseImportInternal(IMPORT_ID, HOUSEHOLD_ID);

    expect(res.ok).toBe(true);
    expect(db.row.status).toBe('parsed');
  });

  it('no reparsea un import confirmado', async () => {
    const db = newDb({ status: 'confirmed' });

    const res = await parseImportInternal(IMPORT_ID, HOUSEHOLD_ID);

    expect(res).toEqual({ ok: false, error: 'invalid_state' });
    expect(db.row.status).toBe('confirmed');
  });

  it('al reparsear reemplaza las líneas pendientes y conserva las confirmadas', async () => {
    const db = newDb({ status: 'parsed' });
    db.lines = [
      { importId: IMPORT_ID, parsedData: { description: 'YA CONFIRMADA' }, transactionId: 'tx-1' },
      { importId: IMPORT_ID, parsedData: { description: 'VIEJA PENDIENTE' }, transactionId: null },
    ];

    const res = await parseImportInternal(IMPORT_ID, HOUSEHOLD_ID);

    expect(res).toEqual({ ok: true, lineCount: 1 });
    expect(db.insertBatches).toBe(1);
    expect(db.lines.map((l) => l.parsedData.description)).toEqual([
      'YA CONFIRMADA',
      'MOVIMIENTO SINTETICO',
    ]);
  });
});

describe('parseImport (server action) — pre-marcado de parsing', () => {
  it('REGRESIÓN: el pre-marcado a parsing NO rompe el parseo posterior', async () => {
    const db = newDb();

    const res = await parseImport(IMPORT_ID);

    // Feedback inmediato para la UI: ya quedó en parsing antes de devolver.
    expect(res).toEqual({ ok: true, queued: true });
    expect(db.row.status).toBe('parsing');
    expect(mocks.afterCallbacks).toHaveLength(1);

    // El trabajo pesado corre después y debe parsear igual (no `already_parsing`
    // contra su propio claim).
    await mocks.afterCallbacks[0]!();
    expect(db.row.status).toBe('parsed');
    expect(db.insertBatches).toBe(1);
    expect(db.lines).toHaveLength(1);
  });

  it('REGRESIÓN: doble click no agenda un segundo parseo', async () => {
    const db = newDb();

    const first = await parseImport(IMPORT_ID);
    const second = await parseImport(IMPORT_ID);

    expect(first).toEqual({ ok: true, queued: true });
    expect(second).toEqual({ ok: false, error: 'already_parsing' });
    expect(mocks.afterCallbacks).toHaveLength(1);

    await mocks.afterCallbacks[0]!();
    expect(db.insertBatches).toBe(1);
    expect(db.lines).toHaveLength(1);
  });

  it('rechaza estados no reparseables sin dejar el import en parsing', async () => {
    const db = newDb({ status: 'confirmed' });

    const res = await parseImport(IMPORT_ID);

    expect(res).toEqual({ ok: false, error: 'invalid_state' });
    expect(db.row.status).toBe('confirmed');
    expect(mocks.afterCallbacks).toHaveLength(0);
  });
});

describe('drainUploadedImports — doble click en "Parsear pendientes"', () => {
  it('REGRESIÓN: dos drenados simultáneos parsean el import una sola vez', async () => {
    const db = newDb();

    // Las dos invocaciones leen la lista de 'uploaded' antes de que ninguna marque
    // nada: es el disparador exacto del incidente.
    const [a, b] = await Promise.all([drainUploadedImports(), drainUploadedImports()]);
    expect(a).toEqual({ ok: true, queued: 1 });
    expect(b).toEqual({ ok: true, queued: 1 });
    expect(mocks.afterCallbacks).toHaveLength(2);

    await Promise.all(mocks.afterCallbacks.map((cb) => cb()));

    expect(db.insertBatches).toBe(1);
    expect(db.lines).toHaveLength(1);
    expect(parseCsvCalls).toBe(1);
  });
});

// Evita que un cambio en el fake pase inadvertido: si alguien agrega otro
// UPDATE ... RETURNING sobre `imports`, el fake tira y este test lo documenta.
describe('doble de prueba', () => {
  it('el fake sólo acepta RETURNING para el claim', async () => {
    const db = new FakeDb(makeRow());
    await expect(db.update(accounts).set({ pdfPassword: 'x' }).returning()).rejects.toThrow();
    await expect(db.update(institutions).set({ status: 'parsing' }).returning()).rejects.toThrow();
  });
});
