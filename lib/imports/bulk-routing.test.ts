import { describe, it, expect } from 'vitest';
import {
  ROUTE_RULES,
  accountNumberMatchesHint,
  buildPlan,
  extractStatementDate,
  preferredCopy,
  routeFile,
  statementKey,
  type PlannedFile,
} from './bulk-routing';

/**
 * CUIL SINTÉTICO. Los nombres reales de BIND embeben el CUIL del titular; acá se
 * usa uno inventado para no meter un identificador real en el repo.
 */
const CUIL = '20111111112';

function plan(paths: readonly string[]): ReturnType<typeof buildPlan> {
  const files: PlannedFile[] = paths.map((relPath) => ({
    relPath,
    rule: routeFile(relPath),
    date: extractStatementDate(relPath.slice(relPath.lastIndexOf('\\') + 1)),
  }));
  return buildPlan(files);
}

describe('extractStatementDate', () => {
  it('lee el formato compacto YYYYMMDD del portal BIND', () => {
    expect(extractStatementDate(`${CUIL}_Visa_20260723.pdf`)).toEqual({
      precision: 'day',
      value: '2026-07-23',
    });
    expect(extractStatementDate(`${CUIL}_Cuentas bantotal_20260630.pdf`)).toEqual({
      precision: 'day',
      value: '2026-06-30',
    });
  });

  it('lee el formato de cierre de Galicia RESUMEN_XXXdd_m_yyyy', () => {
    expect(extractStatementDate('RESUMEN_VISA23_7_2026pdf.pdf')).toEqual({
      precision: 'day',
      value: '2026-07-23',
    });
    expect(extractStatementDate('RESUMEN_MAST31_1_2026pdf.pdf')).toEqual({
      precision: 'day',
      value: '2026-01-31',
    });
    expect(extractStatementDate('RESUMEN_VISA31_12_2025pdf.pdf')).toEqual({
      precision: 'day',
      value: '2025-12-31',
    });
  });

  it('lee YYYY-MM-DD y DD-MM-YYYY de los consolidados de Galicia', () => {
    expect(
      extractStatementDate('RESUMEN_EXTRACTOS CONSOLIDADOS - Caja de ahorro-2026-05-22.pdf'),
    ).toEqual({ precision: 'day', value: '2026-05-22' });
    expect(
      extractStatementDate('RESUMEN_EXTRACTOS CONSOLIDADOS - CAJA DE AHORRO 02-07-2026.pdf'),
    ).toEqual({ precision: 'day', value: '2026-07-02' });
  });

  it('lee los statements de HSBC US', () => {
    expect(extractStatementDate('2026-01-27_Statement.pdf')).toEqual({
      precision: 'day',
      value: '2026-01-27',
    });
  });

  it('cae a precisión de mes cuando el nombre sólo trae el mes', () => {
    expect(extractStatementDate('2026-03.PDF')).toEqual({ precision: 'month', value: '2026-03' });
    expect(extractStatementDate('2026-06 Master ICBC.PDF')).toEqual({
      precision: 'month',
      value: '2026-06',
    });
    expect(extractStatementDate('Amex galicia 2026 06.pdf')).toEqual({
      precision: 'month',
      value: '2026-06',
    });
    expect(extractStatementDate('06-26 EXT.DE.MOVIMIENTOS-5727.pdf')).toEqual({
      precision: 'month',
      value: '2026-06',
    });
  });

  it('entiende los meses escritos con nombre', () => {
    expect(extractStatementDate('resumen_cuenta_visa_Jul_2026.pdf')).toEqual({
      precision: 'month',
      value: '2026-07',
    });
    expect(extractStatementDate('Resumen_MercadoPago_Junio2026.pdf')).toEqual({
      precision: 'month',
      value: '2026-06',
    });
  });

  it('ignora el sufijo de copia " (2)" — es lo que distingue re-descargas', () => {
    const a = extractStatementDate('RESUMEN_VISA25_6_2026pdf.pdf');
    const b = extractStatementDate('RESUMEN_VISA25_6_2026pdf (2).pdf');
    expect(b).toEqual(a);
    expect(extractStatementDate(`${CUIL}_Visa_20260219 (2).pdf`)).toEqual({
      precision: 'day',
      value: '2026-02-19',
    });
  });

  it('devuelve null cuando el nombre no trae fecha', () => {
    expect(extractStatementDate('8610_1040211953.pdf')).toBeNull();
    expect(extractStatementDate('ERESUMEN  VISA.PDF')).toBeNull();
    expect(extractStatementDate('credit-card-mp-statement (4).pdf')).toBeNull();
  });

  it('rechaza fechas imposibles en vez de inventarlas', () => {
    expect(extractStatementDate('RESUMEN_VISA31_2_2026pdf.pdf')).not.toEqual({
      precision: 'day',
      value: '2026-02-31',
    });
    expect(extractStatementDate('algo_20261332.pdf')?.precision).not.toBe('day');
  });
});

describe('routeFile', () => {
  it('separa las DOS Visas de Pau: Galicia vs Banco Industrial', () => {
    expect(routeFile('TC\\Visa Pau\\RESUMEN_VISA23_7_2026pdf.pdf')?.id).toBe('pau-visa-galicia');
    expect(routeFile(`TC\\Visa Pau\\${CUIL}_Visa_20260723.pdf`)?.id).toBe('pau-visa-bind');
  });

  it('rutea los consolidados de la carpeta Pau por titular según la convención', () => {
    // "CAJA DE AHORRO DD-MM-YYYY" es de Nico aunque viva en la carpeta de Pau.
    const nico = routeFile('Pau\\RESUMEN_EXTRACTOS CONSOLIDADOS - CAJA DE AHORRO 02-07-2026.pdf');
    expect(nico?.id).toBe('nico-galicia-ca-consolidado');
    expect(nico?.targets[0]?.ownerTag).toBe('Nico');

    const pau = routeFile('Pau\\RESUMEN_EXTRACTOS CONSOLIDADOS - Caja de ahorro-2026-05-22.pdf');
    expect(pau?.id).toBe('pau-galicia-ca');
    expect(pau?.targets[0]?.ownerTag).toBe('Pau');
  });

  it('el consolidado de BIND mapea a DOS cuentas (ARS y USD), no a una', () => {
    const rule = routeFile(`Pau\\${CUIL}_Cuentas bantotal_20260630.pdf`);
    expect(rule?.id).toBe('pau-bind-cuentas');
    expect(rule?.targets).toHaveLength(2);
    expect(rule?.targets.map((t) => t.currency).sort()).toEqual(['ARS', 'USD']);
    expect(rule?.targets.map((t) => t.accountHint).sort()).toEqual(['/2', '/3']);
  });

  it('desambigua las tres cuentas ICBC por el sufijo del nro de cuenta', () => {
    expect(routeFile('Cuentas\\ICBC\\EXT.DE.MOVIMIENTOS-5727.PDF')?.id).toBe('nico-icbc-cc-5727');
    expect(routeFile('Cuentas\\ICBC\\AV.TRANSF.MINORISTAS-9430.PDF')?.id).toBe(
      'nico-icbc-ca-ars-9430',
    );
    expect(routeFile('Cuentas\\ICBC\\EXT.DE.MOVIMIENTOS-0413.PDF')?.id).toBe(
      'nico-icbc-ca-usd-0413',
    );
  });

  it('rutea las carpetas de tarjetas de Nico', () => {
    expect(routeFile('TC\\Visa ICBC\\2026-01.PDF')?.targets[0]).toMatchObject({
      institutionName: 'ICBC',
      cardBrand: 'visa',
      ownerTag: 'Nico',
    });
    expect(routeFile('TC\\Master HSBC Us\\2026-06-26_Statement.pdf')?.targets[0]).toMatchObject({
      institutionName: 'HSBC US',
      currency: 'USD',
    });
  });

  it('devuelve null para lo que no está en la tabla', () => {
    expect(routeFile('TC\\Proyeccion Financiera.gsheet')).toBeNull();
    expect(routeFile('Otra carpeta\\algo.pdf')).toBeNull();
  });

  it('REGRESIÓN: sigue ruteando DESPUÉS de reorganizar la carpeta', () => {
    // organize-statements mueve los archivos a la carpeta canónica de su regla.
    // Si las reglas sólo conocieran la carpeta ORIGINAL, reorganizar dejaría
    // todo sin ruteo y el import no encontraría nada — la reorganización
    // rompería justo lo que viene a ordenar.
    expect(routeFile('TC\\Visa Galicia Pau\\RESUMEN_VISA23_7_2026pdf.pdf')?.targets[0]).toMatchObject({
      institutionName: 'Galicia',
      ownerTag: 'Pau',
      cardBrand: 'visa',
    });
    expect(routeFile(`TC\\Visa BIND Pau\\${CUIL}_Visa_20260723.pdf`)?.targets[0]).toMatchObject({
      institutionName: 'Banco Industrial',
      ownerTag: 'Pau',
    });
    expect(
      routeFile('Cuentas\\Galicia Nico\\RESUMEN_EXTRACTOS CONSOLIDADOS - CAJA DE AHORRO 02-07-2026.pdf')
        ?.targets[0],
    ).toMatchObject({ institutionName: 'Galicia', ownerTag: 'Nico' });
    expect(
      routeFile('Cuentas\\Galicia Pau\\RESUMEN_EXTRACTOS CONSOLIDADOS - Caja de ahorro-2026-05-22.pdf')
        ?.targets[0],
    ).toMatchObject({ institutionName: 'Galicia', ownerTag: 'Pau' });
    expect(routeFile(`Cuentas\\BIND Pau\\${CUIL}_Cuentas bantotal_20260630.pdf`)?.targets).toHaveLength(2);
  });

  it('reorganizar es idempotente: un archivo ya en su carpeta no se vuelve a mover', () => {
    // El destino de la regla que matchea tiene que ser la carpeta donde ya está.
    const cases = [
      'TC\\Visa Galicia Pau\\RESUMEN_VISA23_7_2026pdf.pdf',
      `TC\\Visa BIND Pau\\${CUIL}_Visa_20260723.pdf`,
      'Cuentas\\Galicia Nico\\RESUMEN_EXTRACTOS CONSOLIDADOS - CAJA DE AHORRO 02-07-2026.pdf',
      'TC\\Amex Galicia\\Amex galicia 2026 06.pdf',
      'Cuentas\\ICBC\\EXT.DE.MOVIMIENTOS-5727.PDF',
    ];
    for (const c of cases) {
      const rule = routeFile(c);
      expect(rule, c).not.toBeNull();
      const currentFolder = c.slice(0, c.lastIndexOf('\\')).replace(/\\/g, '/');
      expect(rule!.folder, c).toBe(currentFolder);
    }
  });

  it('toda regla tiene id único y al menos un target', () => {
    const ids = ROUTE_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of ROUTE_RULES) expect(r.targets.length).toBeGreaterThan(0);
  });
});

describe('preferredCopy', () => {
  it('prefiere el nombre sin sufijo de copia', () => {
    expect(
      preferredCopy(['TC/Visa Pau/RESUMEN_VISA25_6_2026pdf (2).pdf', 'TC/Visa Pau/RESUMEN_VISA25_6_2026pdf.pdf']),
    ).toBe('TC/Visa Pau/RESUMEN_VISA25_6_2026pdf.pdf');
  });

  it('es determinística: el orden de entrada no cambia el resultado', () => {
    const paths = ['b/x (3).pdf', 'a/x (1).pdf', 'c/x (2).pdf'];
    const first = preferredCopy(paths);
    expect(preferredCopy([...paths].reverse())).toBe(first);
  });

  it('devuelve null sin candidatos', () => {
    expect(preferredCopy([])).toBeNull();
  });
});

describe('buildPlan — dedup local', () => {
  it('colapsa las 3 copias del mismo resumen de Pau en UNA sola carga', () => {
    // Caso real: el mismo cierre aparece en TC/Visa Pau y en Pau, con sufijos.
    const entries = plan([
      'TC\\Visa Pau\\RESUMEN_VISA25_6_2026pdf.pdf',
      'TC\\Visa Pau\\RESUMEN_VISA25_6_2026pdf (2).pdf',
      'Pau\\RESUMEN_VISA25_6_2026pdf (2).pdf',
    ]);
    const nuevos = entries.filter((e) => e.status === 'NUEVO');
    expect(nuevos).toHaveLength(1);
    expect(nuevos[0]?.relPath).toBe('TC\\Visa Pau\\RESUMEN_VISA25_6_2026pdf.pdf');
    expect(entries.filter((e) => e.status === 'DUP_LOCAL')).toHaveLength(2);
    for (const dup of entries.filter((e) => e.status === 'DUP_LOCAL')) {
      expect(dup.supersededBy).toBe('TC\\Visa Pau\\RESUMEN_VISA25_6_2026pdf.pdf');
    }
  });

  it('NO colapsa las dos Visas de Pau aunque cierren el mismo día', () => {
    // El bug que esto previene al revés: tratarlas como duplicado perdería una
    // tarjeta entera. Son bancos distintos ⇒ cuentas distintas ⇒ ambas se cargan.
    const entries = plan([
      'TC\\Visa Pau\\RESUMEN_VISA23_7_2026pdf.pdf',
      `TC\\Visa Pau\\${CUIL}_Visa_20260723.pdf`,
    ]);
    const nuevos = entries.filter((e) => e.status === 'NUEVO');
    expect(nuevos).toHaveLength(2);
    expect(nuevos.map((e) => e.target?.institutionName).sort()).toEqual([
      'Banco Industrial',
      'Galicia',
    ]);
  });

  it('el consolidado BIND genera una entrada por cuenta destino', () => {
    const entries = plan([`Pau\\${CUIL}_Cuentas bantotal_20260630.pdf`]);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.status === 'NUEVO')).toBe(true);
    expect(entries.map((e) => e.target?.currency).sort()).toEqual(['ARS', 'USD']);
  });

  it('no confunde meses distintos de la misma cuenta', () => {
    const entries = plan([
      'TC\\Master ICBC\\2026-01 Master ICBC.PDF',
      'TC\\Master ICBC\\2026-02 Master ICBC.PDF',
    ]);
    expect(entries.filter((e) => e.status === 'NUEVO')).toHaveLength(2);
  });

  it('marca SIN_RUTEO y SIN_FECHA en vez de adivinar', () => {
    const entries = plan([
      'Otra\\cosa.pdf',
      'TC\\Visa BNA\\8610_1040211953.pdf',
    ]);
    expect(entries.find((e) => e.relPath === 'Otra\\cosa.pdf')?.status).toBe('SIN_RUTEO');
    expect(entries.find((e) => e.relPath.includes('8610'))?.status).toBe('SIN_FECHA');
  });

  it('es idempotente: el mismo input da el mismo plan', () => {
    const paths = [
      'TC\\Visa Pau\\RESUMEN_VISA25_6_2026pdf.pdf',
      'Pau\\RESUMEN_VISA25_6_2026pdf (2).pdf',
      `Pau\\${CUIL}_Cuentas bantotal_20260630.pdf`,
    ];
    expect(plan(paths)).toEqual(plan(paths));
  });
});

describe('accountNumberMatchesHint', () => {
  it('matchea los últimos dígitos del nombre de archivo ICBC contra el nro formateado', () => {
    // El archivo se llama "...-5727" pero la cuenta guarda "0905/02100757/27".
    // Un includes() crudo NO matchea: hay que ignorar los separadores.
    expect(accountNumberMatchesHint('0905/02100757/27', '5727')).toBe(true);
    expect(accountNumberMatchesHint('0905/11102104/13', '0413')).toBe(true);
    expect(accountNumberMatchesHint('0926/01109094/30', '0926')).toBe(true);
  });

  it('no matchea una cuenta ICBC ajena', () => {
    expect(accountNumberMatchesHint('0926/01109094/30', '5727')).toBe(false);
    expect(accountNumberMatchesHint('0905/02100757/27', '0413')).toBe(false);
  });

  it('el hint de sub-cuenta "/N" es sufijo EXACTO, no comparación por dígitos', () => {
    // Comparar sólo dígitos rompería: "7434492" contiene un "3" en el medio y
    // matchearía la sub-cuenta equivocada.
    expect(accountNumberMatchesHint('743449/3', '/3')).toBe(true);
    expect(accountNumberMatchesHint('743449/2', '/2')).toBe(true);
    expect(accountNumberMatchesHint('743449/2', '/3')).toBe(false);
    expect(accountNumberMatchesHint('743449/3', '/2')).toBe(false);
  });

  it('sin número de cuenta o sin hint no matchea', () => {
    expect(accountNumberMatchesHint(null, '5727')).toBe(false);
    expect(accountNumberMatchesHint('', '5727')).toBe(false);
    expect(accountNumberMatchesHint('0905/02100757/27', '')).toBe(false);
  });
});

describe('statementKey', () => {
  it('distingue cuentas por institución, dueño, moneda y hint', () => {
    const base = {
      institutionName: 'ICBC',
      importType: 'banco' as const,
      ownerTag: 'Nico' as const,
      accountType: 'bank_savings' as const,
      currency: 'ARS' as const,
    };
    const date = { precision: 'month' as const, value: '2026-06' };
    expect(statementKey(base, date)).not.toBe(
      statementKey({ ...base, accountHint: '0413' }, date),
    );
    expect(statementKey(base, date)).not.toBe(statementKey({ ...base, currency: 'USD' }, date));
    expect(statementKey(base, date)).toBe(statementKey({ ...base }, date));
  });
});
