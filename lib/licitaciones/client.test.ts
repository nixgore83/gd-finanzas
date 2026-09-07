import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/env', () => ({ getLicitacionesServiceEnv: vi.fn() }));
import { getLicitacionesServiceEnv } from '@/lib/env';
import { parseWarningsHeader, procesarLicitaciones } from './client';

const mockedEnv = vi.mocked(getLicitacionesServiceEnv);

function setEnv(over: Record<string, unknown> = {}) {
  mockedEnv.mockReturnValue({
    LICITACIONES_SERVICE_URL: 'https://svc.test',
    LICITACIONES_SERVICE_SECRET: 'x'.repeat(16),
    ...over,
  } as unknown as ReturnType<typeof getLicitacionesServiceEnv>);
}

const onePdf = { pdfUrls: ['https://storage.test/signed/input_0.pdf?token=abc'] };

beforeEach(() => {
  setEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('procesarLicitaciones', () => {
  it('not_configured cuando faltan env vars', async () => {
    setEnv({ LICITACIONES_SERVICE_URL: undefined, LICITACIONES_SERVICE_SECRET: undefined });
    const r = await procesarLicitaciones(onePdf);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_configured');
  });

  it('éxito: devuelve xlsx + modelo del header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([9, 9, 9]), {
        status: 200,
        headers: { 'x-model-used': 'claude-sonnet-4-5' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const r = await procesarLicitaciones({ ...onePdf, lunes: '2026-05-04' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Array.from(r.xlsx)).toEqual([9, 9, 9]);
      expect(r.model).toBe('claude-sonnet-4-5');
    }
    // Verificá URL + auth header + body JSON con las signed URLs (no multipart).
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://svc.test/procesar');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${'x'.repeat(16)}`);
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      pdf_urls: onePdf.pdfUrls,
      lunes: '2026-05-04',
    });
  });

  it('http_error: extrae {error} del body JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'template roto' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const r = await procesarLicitaciones(onePdf);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('http_error');
      expect(r.error).toBe('template roto');
    }
  });

  it('http_error 413 sin JSON → mensaje de tamaño, no "HTTP 413" crudo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Payload Too Large', { status: 413 })),
    );
    const r = await procesarLicitaciones(onePdf);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('http_error');
      expect(r.error).toMatch(/tamaño|tanda/i);
      expect(r.error).not.toBe('HTTP 413');
    }
  });

  it('http_error status no mapeado sin JSON → incluye el código', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 418 })));
    const r = await procesarLicitaciones(onePdf);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('http_error');
      expect(r.error).toContain('418');
    }
  });

  it('timeout: AbortError → code timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    );
    const r = await procesarLicitaciones(onePdf);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('timeout');
  });

  it('network: error genérico → code network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const r = await procesarLicitaciones(onePdf);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('network');
  });
});

// ── Resultado parcial ───────────────────────────────────────────────────────
// El micro devuelve 200 con el Excel aunque algún PDF haya roto. Antes eso se
// perdía en silencio; ahora lo informa en los headers y el cliente lo propaga.

const cincoPdfs = {
  pdfUrls: Array.from(
    { length: 5 },
    (_, i) => `https://storage.test/signed/input_${i}.pdf?token=abc`,
  ),
};

function okResponse(headers: Record<string, string>): Response {
  return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers });
}

describe('procesarLicitaciones — resultado parcial', () => {
  it('200 con todos OK: pdfsOk === recibidos y sin fallidos', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          'x-model-used': 'claude-sonnet-4-5',
          'x-pdfs-recibidos': '5',
          'x-pdfs-ok': '5',
          'x-pdfs-fallidos': '0',
        }),
      ),
    );

    const r = await procesarLicitaciones(cincoPdfs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.recibidos).toBe(5);
      expect(r.pdfsOk).toBe(5);
      expect(r.fallidos).toEqual([]);
    }
  });

  it('200 parcial: propaga el conteo y el detalle de los que fallaron', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          'x-pdfs-recibidos': '5',
          'x-pdfs-ok': '3',
          'x-pdfs-fallidos': '2',
          'x-warnings':
            'input_0.pdf: Error code: 400 - The PDF specified was not valid.; ' +
            'input_1.pdf: Error code: 400 - The PDF specified was not valid.',
        }),
      ),
    );

    const r = await procesarLicitaciones(cincoPdfs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.recibidos).toBe(5);
      expect(r.pdfsOk).toBe(3);
      expect(r.fallidos.map((f) => f.pdf)).toEqual(['input_0.pdf', 'input_1.pdf']);
      expect(r.fallidos[0]!.error).toContain('not valid');
      // El Excel parcial se devuelve igual: sirve, aunque le falten instrumentos.
      expect(Array.from(r.xlsx)).toEqual([1, 2, 3]);
    }
  });

  it('micro viejo sin los headers: asume todos OK (comportamiento previo)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({})));

    const r = await procesarLicitaciones(cincoPdfs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.recibidos).toBe(5);
      expect(r.pdfsOk).toBe(5);
      expect(r.fallidos).toEqual([]);
    }
  });

  it('headers basura no rompen: cae al fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          okResponse({ 'x-pdfs-recibidos': 'no-es-un-numero', 'x-pdfs-ok': '-1' }),
        ),
    );

    const r = await procesarLicitaciones(cincoPdfs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.recibidos).toBe(5);
      expect(r.pdfsOk).toBe(5);
    }
  });
});

describe('parseWarningsHeader', () => {
  it('vacío o ausente → []', () => {
    expect(parseWarningsHeader(null)).toEqual([]);
    expect(parseWarningsHeader('')).toEqual([]);
    expect(parseWarningsHeader('   ')).toEqual([]);
  });

  it('separa por PDF y conserva el motivo', () => {
    expect(parseWarningsHeader('input_0.pdf: roto; input_2.pdf: sin clases')).toEqual([
      { pdf: 'input_0.pdf', error: 'roto' },
      { pdf: 'input_2.pdf', error: 'sin clases' },
    ]);
  });

  it('no corta un motivo que contiene "; " adentro', () => {
    const raw = 'input_0.pdf: fallo A; ademas fallo B; input_1.pdf: otro';
    expect(parseWarningsHeader(raw)).toEqual([
      { pdf: 'input_0.pdf', error: 'fallo A; ademas fallo B' },
      { pdf: 'input_1.pdf', error: 'otro' },
    ]);
  });

  it('formato inesperado: no lo tira, lo devuelve como warning suelto', () => {
    expect(parseWarningsHeader('algo raro sin formato')).toEqual([
      { pdf: 'desconocido', error: 'algo raro sin formato' },
    ]);
  });

  it('motivo vacío → "sin detalle"', () => {
    expect(parseWarningsHeader('input_0.pdf:')).toEqual([
      { pdf: 'input_0.pdf', error: 'sin detalle' },
    ]);
  });
});
