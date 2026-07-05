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
 * Traduce un status HTTP de error a un mensaje entendible para Pau, cuando la
 * respuesta no trae JSON `{error}` (típico de un proxy/host que corta antes de
 * llegar a FastAPI). El 413 lo tira un host que limita el body (Vercel ~4.5 MB);
 * no debería pasar en Railway/Render, pero lo mapeamos por las dudas.
 */
function messageForHttpStatus(status: number): string {
  switch (status) {
    case 413:
      return 'Los PDFs superan el límite de tamaño del servidor. Probá con una tanda más chica.';
    case 401:
    case 403:
      return 'El servicio rechazó la autenticación. Avisá a Nico (revisar el secreto compartido).';
    case 429:
      return 'El servicio está saturado. Esperá un momento y reintentá.';
    case 502:
    case 503:
    case 504:
      return 'El servicio de procesamiento no está disponible ahora. Reintentá en unos minutos.';
    default:
      return `El servicio respondió un error (HTTP ${status}).`;
  }
}

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
    // El microservicio devuelve JSON {error} en fallos esperados; si no viene
    // (ej. 413 de un proxy antes de FastAPI), traducimos el status a algo claro.
    let detail = messageForHttpStatus(res.status);
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      /* respuesta no-JSON; nos quedamos con el mensaje por status */
    }
    console.error('[licitaciones] microservicio respondió error', { status: res.status });
    return { ok: false, code: 'http_error', error: detail };
  }

  const model = res.headers.get('x-model-used') || DEFAULT_LICITACIONES_MODEL;
  const buf = await res.arrayBuffer();
  return { ok: true, xlsx: new Uint8Array(buf), model };
}
