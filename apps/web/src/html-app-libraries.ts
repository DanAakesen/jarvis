import { htmlAppLibraries, type HtmlAppLibrary } from '@jarvis/contracts';

const maxLibraryAssetBytes = 8 * 1024 * 1024;
const librarySet = new Set<string>(htmlAppLibraries);

interface HtmlAppLibraryAssets {
  readonly script: string;
  readonly style: string;
}

async function readText(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxLibraryAssetBytes) {
    throw new Error('A requested HTML app library exceeded its size limit.');
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxLibraryAssetBytes) {
      throw new Error('A requested HTML app library exceeded its size limit.');
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxLibraryAssetBytes) throw new Error('A requested HTML app library exceeded its size limit.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function createHtmlAppLibraryLoader(
  fetcher: typeof fetch = fetch,
  baseUrl = import.meta.env.BASE_URL,
) {
  const cache = new Map<HtmlAppLibrary, Promise<HtmlAppLibraryAssets>>();
  const load = (name: HtmlAppLibrary) => {
    let assets = cache.get(name);
    if (!assets) {
      assets = (async () => {
        const base = new URL(baseUrl, window.location.href);
        const loadAsset = async (extension: 'js' | 'css') => {
          const url = new URL(`html-app-libraries/${name}.${extension}`, base);
          const response = await fetcher(url, {
            cache: 'force-cache',
            credentials: 'omit',
            mode: 'same-origin',
            referrerPolicy: 'no-referrer',
          });
          if (!response.ok) throw new Error('A requested HTML app library is unavailable.');
          return readText(response);
        };
        const [script, style] = await Promise.all([
          loadAsset('js'),
          name === 'katex' || name === 'leaflet-offline' ? loadAsset('css') : Promise.resolve(''),
        ]);
        return { script, style };
      })();
      cache.set(name, assets);
    }
    return assets.catch((error: unknown) => {
      cache.delete(name);
      throw error;
    });
  };

  return async (html: string): Promise<string> => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const placeholders = [...document.querySelectorAll('script[data-jarvis-lib]')];
    if (placeholders.length === 0) return html;

    const requested = placeholders.map((placeholder) => {
      const name = placeholder.getAttribute('data-jarvis-lib');
      if (!name || !librarySet.has(name) ||
          placeholder.attributes.length !== 1 || placeholder.textContent?.trim()) {
        throw new Error('The HTML app requested an invalid local library.');
      }
      return name as HtmlAppLibrary;
    });
    const assets = new Map(await Promise.all([...new Set(requested)].map(async (name) =>
      [name, await load(name)] as const)));
    const styleText = [...assets.values()].map(({ style }) => style).filter(Boolean).join('\n');
    if (styleText) {
      const style = document.createElement('style');
      style.textContent = styleText.replace(/<\/style/giu, '\\3c /style');
      document.head.prepend(style);
    }
    const injected = new Set<HtmlAppLibrary>();
    placeholders.forEach((placeholder, index) => {
      const name = requested[index]!;
      if (injected.has(name)) {
        placeholder.remove();
        return;
      }
      injected.add(name);
      const script = document.createElement('script');
      script.textContent = assets.get(name)!.script.replace(/<\/script/giu, '\\x3c/script');
      placeholder.replaceWith(script);
    });
    return document.documentElement.outerHTML;
  };
}

export const inlineHtmlAppLibraries = createHtmlAppLibraryLoader();
