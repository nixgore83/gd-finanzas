import { z } from 'zod';

/**
 * Cliente para la API pública del BCRA — Principales Variables (Estadísticas
 * Monetarias v3). Doc oficial: https://www.bcra.gob.ar/Catalogo/apis.asp
 *
 * No depende de la DB ni de imports server-only de Next; usable desde scripts
 * y desde Server Actions.
 */

const BASE_URL = 'https://api.bcra.gob.ar/estadisticas/v4.0';
const DEFAULT_TIMEOUT_MS = 15_000;

const bcraVariableSchema = z.object({
  idVariable: z.number().int(),
  descripcion: z.string(),
  categoria: z.string().optional(),
});

const variablesEnvelopeSchema = z.object({
  status: z.number().optional(),
  results: z.array(bcraVariableSchema),
});

// v4 anida los puntos dentro de `detalle` por variable.
const seriesEnvelopeSchema = z.object({
  status: z.number().optional(),
  results: z.array(
    z.object({
      idVariable: z.number().int(),
      detalle: z.array(z.object({ fecha: z.string(), valor: z.number() })),
    }),
  ),
});

export type BcraVariable = z.infer<typeof bcraVariableSchema>;
export type BcraSeriesPoint = { idVariable: number; fecha: string; valor: number };

export class BcraApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string,
  ) {
    super(message);
    this.name = 'BcraApiError';
  }
}

async function bcraGet(path: string): Promise<unknown> {
  const url = `${BASE_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new BcraApiError(`BCRA fetch failed: ${msg}`, null, url);
  }
  if (!res.ok) {
    throw new BcraApiError(`BCRA returned ${res.status}`, res.status, url);
  }
  return (await res.json()) as unknown;
}

export async function listBcraVariables(): Promise<BcraVariable[]> {
  const json = await bcraGet('/Monetarias');
  const parsed = variablesEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new BcraApiError(
      `BCRA variables payload no matchea schema: ${parsed.error.message}`,
      null,
      `${BASE_URL}/Monetarias`,
    );
  }
  return parsed.data.results;
}

export async function fetchBcraSeries(args: {
  idVariable: number;
  desde: string;
  hasta: string;
  limit?: number;
}): Promise<BcraSeriesPoint[]> {
  const limit = args.limit ?? 3000;
  const path = `/Monetarias/${args.idVariable}?desde=${args.desde}&hasta=${args.hasta}&limit=${limit}`;
  const json = await bcraGet(path);
  const parsed = seriesEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new BcraApiError(
      `BCRA series payload no matchea schema: ${parsed.error.message}`,
      null,
      `${BASE_URL}${path}`,
    );
  }
  return parsed.data.results.flatMap((g) =>
    g.detalle.map((p) => ({ idVariable: g.idVariable, fecha: p.fecha, valor: p.valor })),
  );
}
