import JSZip from 'jszip';
import { buildIngresosCsv } from './ingresos';
import { buildConsumosTcCsv } from './consumos-tc';
import { buildServicioDomesticoCsv } from './servicio-domestico';
import { buildGastosDeduciblesCsv } from './gastos-deducibles';
import { buildOtrosIngresosCsv } from './otros-ingresos';
import { buildReadme } from './readme';
import type { GananciasData } from './ganancias-data';

export async function buildGananciasZip(data: GananciasData): Promise<Uint8Array> {
  const zip = new JSZip();

  zip.file(
    '01_ingresos.csv',
    buildIngresosCsv(data.txns, data.accountsById, data.categoriesById),
  );
  zip.file('02_consumos_tc.csv', buildConsumosTcCsv(data.txns, data.accountsById));
  zip.file('03_servicio_domestico.csv', buildServicioDomesticoCsv(data.txns));
  zip.file(
    '04_gastos_deducibles.csv',
    buildGastosDeduciblesCsv(data.txns, data.accountsById, data.categoriesById),
  );
  zip.file(
    '05_otros_ingresos.csv',
    buildOtrosIngresosCsv(data.txns, data.accountsById, data.categoriesById),
  );
  zip.file('README.txt', buildReadme(data.year, data.householdName));

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
