import JSZip from 'jszip';
import { toCsv } from '@/lib/exports/csv';
import type { HouseholdSnapshot } from './snapshot';

function buildReadme(snapshot: HouseholdSnapshot): string {
  const counts = Object.entries(snapshot.tables)
    .map(([table, rows]) => `  ${table}: ${(rows as unknown[]).length}`)
    .join('\n');
  return `BACKUP gd-finanzas
====================

Generado: ${snapshot.generatedAt}
Household: ${snapshot.householdId}

CONTENIDO
---------
- snapshot.json — dump completo en JSON con todas las tablas.
- tables/*.csv  — un CSV por tabla (UTF-8 con BOM, CRLF).

CONTEO DE FILAS
---------------
${counts}

RESTORE
-------
V1 no incluye endpoint de restore. Para restaurar manualmente:

1. Detener escrituras (cerrar la app).
2. Conectarse a Postgres con DIRECT_URL.
3. Decidir si TRUNCATE las tablas afectadas o restaurar incremental.
4. Cargar las filas desde snapshot.json o los CSVs. Respetar el orden
   de dependencias (households → categories/accounts/recurrences →
   transactions → transaction_tags/forecasts/import_lines/budgets).

Si en V2 se implementa restore endpoint, este README desaparece.

CONSIDERACIONES
---------------
- Los IDs de filas son UUIDs estables; no chocan al re-insertar.
- "auth.users" NO está en el backup (Supabase lo maneja aparte).
- Los PDFs originales subidos a /imports tampoco están: son data del
  banco, re-descargables desde sus portales si hace falta.
`;
}

export async function buildBackupZip(snapshot: HouseholdSnapshot): Promise<Uint8Array> {
  const zip = new JSZip();

  // 1. JSON consolidado.
  zip.file('snapshot.json', JSON.stringify(snapshot, null, 2));

  // 2. CSV por tabla.
  const tablesFolder = zip.folder('tables');
  if (!tablesFolder) throw new Error('jszip folder() returned null');

  for (const [tableName, rows] of Object.entries(snapshot.tables)) {
    const rowsArr = rows as Array<Record<string, unknown>>;
    if (rowsArr.length === 0) {
      // Vacío: igual incluir el archivo con header dummy.
      tablesFolder.file(`${tableName}.csv`, '﻿(sin filas)\r\n');
      continue;
    }
    const headers = Object.keys(rowsArr[0]!).map((key) => ({ key, label: key }));
    tablesFolder.file(`${tableName}.csv`, toCsv(rowsArr, headers));
  }

  // 3. README.
  zip.file('README.txt', buildReadme(snapshot));

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
