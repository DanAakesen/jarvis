import { describe, expect, it, vi } from 'vitest';
import { createHtmlAppLibraryLoader } from './html-app-libraries';

describe('HTML app local libraries', () => {
  it('loads only requested vetted bundles and injects their code and styles inline', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(url.endsWith('katex.css') ? '.math{color:red}' : `window.loaded='${url}'`, {
        status: 200,
      });
    });
    const inline = createHtmlAppLibraryLoader(fetcher as typeof fetch, '/');
    const result = await inline(
      '<!doctype html><html><head></head><body><script data-jarvis-lib="katex"></script>' +
      '<script>renderMath();</script></body></html>',
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
      expect.stringMatching(/html-app-libraries\/katex\.js$/u),
      expect.stringMatching(/html-app-libraries\/katex\.css$/u),
    ]));
    expect(result).toContain('<style>.math{color:red}</style>');
    expect(result).toContain('<script>window.loaded=');
    expect(result).toContain('<script>renderMath();</script>');
    expect(result).not.toContain('data-jarvis-lib');
  });

  it('rejects unsupported placeholders without fetching and caches requested bundles', async () => {
    const fetcher = vi.fn(async () => new Response('window.loaded=true', { status: 200 }));
    const inline = createHtmlAppLibraryLoader(fetcher as typeof fetch, '/');

    await expect(inline('<!doctype html><script data-jarvis-lib="unknown"></script>'))
      .rejects.toThrow('invalid local library');
    expect(fetcher).not.toHaveBeenCalled();

    await inline('<!doctype html><script data-jarvis-lib="chart"></script>');
    await inline('<!doctype html><script data-jarvis-lib="chart"></script>');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
