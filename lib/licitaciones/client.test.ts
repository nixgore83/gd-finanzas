import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/env', () => ({ getServerEnv: vi.fn() }));
import { getServerEnv } from '@/lib/env';
import { procesarLicitaciones } from './client';

const mockedEnv = vi.mocked(getServerEnv);

function setEnv(over: Record<string, unknown> = {}) {
  mockedEnv.mockReturnValue({
    LICITACIONES_SERVICE_URL: 'https://svc.test',
    LICITACIONES_SERVICE_SECRET: 'x'.repeat(16),
    ...over,
  } as unknown as ReturnType<typeof getServerEnv>);
}

const onePdf = { pdfs: [{ filename: 'a.pdf', bytes: new Uint8Array([1, 2, 3]) }] };

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
    // Verificá auth header + URL.
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://svc.test/procesar');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${'x'.repeat(16)}`);
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
