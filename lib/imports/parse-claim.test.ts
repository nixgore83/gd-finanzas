import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  isReparseableStatus,
  parseClaimWhere,
  PARSE_CLAIM_STALE_SECONDS,
  REPARSEABLE_STATUSES,
} from './parse-claim';

function compile(importId: string, householdId: string) {
  const where = parseClaimWhere(importId, householdId) as SQL;
  return new PgDialect().sqlToQuery(where);
}

describe('isReparseableStatus', () => {
  it('acepta los estados reparseables', () => {
    for (const s of REPARSEABLE_STATUSES) expect(isReparseableStatus(s)).toBe(true);
  });

  it('rechaza estados terminales / desconocidos', () => {
    expect(isReparseableStatus('confirmed')).toBe(false);
    expect(isReparseableStatus('lo-que-sea')).toBe(false);
  });

  it('incluye "parsing" (el pre-marcado de parseImport y los parseos cortados)', () => {
    expect(isReparseableStatus('parsing')).toBe(true);
  });
});

describe('parseClaimWhere', () => {
  it('filtra por id + household', () => {
    const { sql, params } = compile('imp-1', 'hh-1');
    expect(sql).toContain('"id" = ');
    expect(sql).toContain('"household_id" = ');
    expect(params).toContain('imp-1');
    expect(params).toContain('hh-1');
  });

  it('exige un estado reparseable (no se reparsea un import confirmado)', () => {
    const { sql, params } = compile('imp-1', 'hh-1');
    expect(sql).toContain('"status" in ');
    for (const s of REPARSEABLE_STATUSES) expect(params).toContain(s);
  });

  it('excluye los que YA están en parsing salvo que estén stale', () => {
    const { sql, params } = compile('imp-1', 'hh-1');
    // La pata que gana la carrera: nadie más lo está parseando…
    expect(sql).toContain('"status" <> ');
    expect(params).toContain('parsing');
    // …o el ejecutor anterior murió (escape para no dejarlo trabado para siempre).
    expect(sql).toContain('coalesce');
    expect(sql).toContain('make_interval');
    expect(params).toContain(PARSE_CLAIM_STALE_SECONDS);
  });

  it('usa created_at como fallback cuando no hay parsing_started_at', () => {
    const { sql } = compile('imp-1', 'hh-1');
    expect(sql).toMatch(
      /coalesce\("imports"\."parsing_started_at", "imports"\."created_at"\)/,
    );
  });
});
