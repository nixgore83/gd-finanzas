import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadGananciasData } from '@/lib/exports/ganancias-data';
import { buildGananciasZip } from '@/lib/exports/ganancias-zip';

const yearSchema = z
  .string()
  .regex(/^\d{4}$/)
  .transform((s) => Number(s))
  .pipe(z.number().int().gte(2020).lte(2100));

export async function GET(request: Request): Promise<Response> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }

  const url = new URL(request.url);
  const yearParam = url.searchParams.get('year');
  const now = new Date().getFullYear();

  let year: number;
  if (yearParam) {
    const parsed = yearSchema.safeParse(yearParam);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_year' }, { status: 400 });
    }
    year = parsed.data;
  } else {
    year = now;
  }

  const data = await loadGananciasData(session.householdId, year);
  const bytes = await buildGananciasZip(data);

  const householdSlug = data.householdName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const filename = `ganancias-${year}-${householdSlug}.zip`;

  // NextResponse no maneja bien Uint8Array directo en todos los runtimes;
  // usamos Response nativo con el buffer.
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  return new Response(arrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
