import { getLicitacionesServiceEnv } from '@/lib/env';
import {
  DEFAULT_LICITACIONES_MODEL,
  LICITACIONES_PDF_CONTENT_TYPE,
} from '@/lib/schemas/licitaciones';

/**
 * Timeout de la llamada al microservicio, por debajo de la maxDuration de la ruta
 * (300s). El microservicio hace N llamadas al LLM (una por PDF) + arma el Excel;
 * ~30–60s típico, damos margen amplio.
 */
const SERVICE_TIMEOUT_MS = 280_000;

export type ProcesarInput = {
  pdfs: Array<{ filename: string; bytes: Uint8Array }>;
  /** Override de la fecha del lunes (YYYY-MM-DD). Omitido = próximo lunes. */
  lunes?: string | null;
};

export type ProcesarResult =
  | { ok: true; xlsx: Uint8Array; model: string }
  | { ok: false; error: string; code: 'not_configured' | 'http_error' | 'timeout' | 'network' };

/**
 * Llama al microservicio Python (`POST {URL}/procesar`) con los PDFs como
 * multipart y devuelve el Excel binario. Auth por `Authorization: Bearer`
 * (secreto compartido). No reintenta: el caller decide (el job queda 'error' y
 * Pau reintenta). Nunca loguea contenido de los PDFs ni montos.
 */
export async function procesarLicitaciones(input: ProcesarInput): Promise<ProcesarResult> {
  const env = getLicitacionesServiceEnv();
  if (!env.LICITACIONES_SERVICE_URL || !env.LICITACIONES_SERVICE_SECRET) {
    return {
      ok: false,
      code: 'not_configured',
      error: 'El microservicio de licitaciones no está configurado (faltan env vars).',
    };
  }

  const form = new FormData();
  for (const pdf of input.pdfs) {
    // `slice()` devuelve una copia con su propio ArrayBuffer (no Shared, no view),
    // que es un BlobPart válido y respeta el rango exacto de los bytes.
    form.append(
      'files',
      new Blob([pdf.bytes.slice()], { type: LICITACIONES_PDF_CONTENT_TYPE }),
      pdf.filename,
    );
  }
  if (input.lunes) form.append('lunes', input.lunes);

  const url = `${env.LICITACIONES_SERVICE_URL.replace(/\/$/, '')}/procesar`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVICE_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.LICITACIONES_SERVICE_SECRET}` },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, code: 'timeout', error: 'El microservicio tardó demasiado (timeout).' };
    }
    console.error('[licitaciones] fetch al microservicio falló', {
      name: err instanceof Error ? err.name : 'unknown',
    });
    return { ok: false, code: 'network', error: 'No se pudo contactar al microservicio.' };
  }
  clearTimeout(timer);

  if (!res.ok) {
    // El microservicio devuelve JSON {error} en fallos esperados.
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      /* respuesta no-JSON; nos quedamos con el status */
    }
    console.error('[licitaciones] microservicio respondió error', { status: res.status });
    return { ok: false, code: 'http_error', error: detail };
  }

  const model = res.headers.get('x-model-used') || DEFAULT_LICITACIONES_MODEL;
  const buf = await res.arrayBuffer();
  return { ok: true, xlsx: new Uint8Array(buf), model };
}
