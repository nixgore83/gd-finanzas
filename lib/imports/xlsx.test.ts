import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { readXlsxRows } from './xlsx';

async function buildXlsx(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('readXlsxRows', () => {
  it('lee celdas inline (t="str") con namespace x: y conserva newlines', async () => {
    const sheet = `<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>` +
      `<x:row r="1"><x:c r="A1" t="str"><x:v>Fecha</x:v></x:c><x:c r="B1" t="str"><x:v>Movimiento</x:v></x:c></x:row>` +
      `<x:row r="2"><x:c r="A2" t="str"><x:v>09/06/2026</x:v></x:c><x:c r="B2" t="str"><x:v>TRANSF.
CU 20305551067</x:v></x:c><x:c r="C2" t="str"><x:v>-99.235,24</x:v></x:c></x:row>` +
      `</x:sheetData></x:worksheet>`;
    const bytes = await buildXlsx({ 'xl/worksheets/sheet1.xml': sheet });
    const rows = await readXlsxRows(bytes);
    expect(rows[0]).toEqual(['Fecha', 'Movimiento']);
    expect(rows[1]![0]).toBe('09/06/2026');
    expect(rows[1]![1]).toContain('\n');
    expect(rows[1]![2]).toBe('-99.235,24');
  });

  it('resuelve sharedStrings (t="s")', async () => {
    const shared = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">` +
      `<si><t>Hola</t></si><si><t>Mundo</t></si></sst>`;
    const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
      `</sheetData></worksheet>`;
    const bytes = await buildXlsx({
      'xl/worksheets/sheet1.xml': sheet,
      'xl/sharedStrings.xml': shared,
    });
    const rows = await readXlsxRows(bytes);
    expect(rows[0]).toEqual(['Hola', 'Mundo']);
  });

  it('respeta posiciones de columna por referencia (celdas dispersas)', async () => {
    const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
      `<row r="1"><c r="A1" t="str"><v>x</v></c><c r="C1" t="str"><v>z</v></c></row>` +
      `</sheetData></worksheet>`;
    const bytes = await buildXlsx({ 'xl/worksheets/sheet1.xml': sheet });
    const rows = await readXlsxRows(bytes);
    expect(rows[0]).toEqual(['x', '', 'z']);
  });
});
