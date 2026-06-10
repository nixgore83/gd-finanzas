import JSZip from 'jszip';

/**
 * Lectura mínima de un `.xlsx` a una matriz de celdas (string[][]), sin dependencias
 * nuevas: reutiliza `jszip` (ya dep, ver lib/backups/build-zip.ts) para descomprimir y
 * parsea el XML de la hoja con regex tolerante (namespace `x:` o sin prefijo; valores
 * inline `t="str"`/`t="inlineStr"` y `sharedStrings` `t="s"`).
 *
 * No pretende soportar todo OOXML — alcanza para los exports tabulares de homebanking
 * (ej. Galicia). Las celdas pueden contener `\n` (campos multilínea).
 */

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '\r')
    .replace(/&amp;/g, '&');
}

function colToIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const siRe = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    const parts: string[] = [];
    const tRe = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(m[1] ?? ''))) parts.push(unescapeXml(tm[1] ?? ''));
    out.push(parts.join(''));
  }
  return out;
}

export async function readXlsxRows(bytes: Uint8Array): Promise<string[][]> {
  const zip = await JSZip.loadAsync(bytes);
  const sheetFile = zip.file('xl/worksheets/sheet1.xml');
  if (!sheetFile) throw new Error('xlsx sin xl/worksheets/sheet1.xml');
  const sheetXml = await sheetFile.async('string');
  const ssFile = zip.file('xl/sharedStrings.xml');
  const shared = parseSharedStrings(ssFile ? await ssFile.async('string') : undefined);

  const rows: string[][] = [];
  const rowRe = /<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(sheetXml))) {
    const cells: string[] = [];
    const cellRe = /<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1] ?? ''))) {
      const attrs = cm[1] ?? '';
      const inner = cm[2] ?? '';
      const ref = attrs.match(/r="([A-Z]+)\d+"/)?.[1];
      const col = ref ? colToIndex(ref) : cells.length;
      const type = attrs.match(/t="(\w+)"/)?.[1] ?? 'n';

      let val = '';
      if (type === 's') {
        const v = inner.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/);
        val = shared[v?.[1] != null ? Number(v[1]) : -1] ?? '';
      } else if (type === 'inlineStr') {
        const tRe = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g;
        const parts: string[] = [];
        let tm: RegExpExecArray | null;
        while ((tm = tRe.exec(inner))) parts.push(unescapeXml(tm[1] ?? ''));
        val = parts.join('');
      } else {
        // 'str' (resultado de fórmula) o número → <v>
        const v = inner.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/);
        val = v ? unescapeXml(v[1] ?? '') : '';
      }
      cells[col] = val;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}
