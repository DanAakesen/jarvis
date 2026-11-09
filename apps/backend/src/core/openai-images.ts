import sharp from 'sharp';
import { workspaceImageSizeLimit } from '../database/workspace-artifact-store.js';
import { ToolFailure } from './tool-registry.js';

export interface ImageGenerator {
  generate(prompt: string, signal: AbortSignal): Promise<{ contentType: 'image/png'; bytes: Buffer }>;
}

interface Options {
  model: string;
  getApiKey: (signal: AbortSignal) => Promise<string | undefined>;
  fetcher?: typeof fetch;
  logger?: { warn(data: { reason: string; status?: number }, message: string): void };
}

const responseLimit = Math.ceil(workspaceImageSizeLimit / 3) * 4 + 64 * 1024;

/** One paid generation per invocation. Never replay an uncertain image request. */
export function createOpenAIImageGenerator(options: Options): ImageGenerator {
  const fetcher = options.fetcher ?? fetch;
  function failure(reason: string, message: string, status?: number): ToolFailure {
    options.logger?.warn({ reason, ...(status === undefined ? {} : { status }) }, 'image_generation.failed');
    return new ToolFailure(message);
  }
  return {
    async generate(prompt, signal) {
      signal.throwIfAborted();
      let key: string | undefined;
      try { key = await options.getApiKey(signal); }
      catch {
        signal.throwIfAborted();
        throw failure('credential_unavailable', 'The OpenAI image API credential could not be read from Key Vault.');
      }
      if (!key?.trim() || /[\r\n]/u.test(key)) {
        throw failure('credential_missing', 'The OpenAI image API credential is not configured in Key Vault.');
      }
      let response: Response;
      try {
        response = await fetcher('https://api.openai.com/v1/images/generations', {
          method: 'POST', redirect: 'error', signal,
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ model: options.model, prompt, n: 1, size: 'auto', quality: 'medium', output_format: 'png' }),
        });
      } catch {
        signal.throwIfAborted();
        throw failure('transport_failed', 'The OpenAI image request was interrupted; its result is unknown.');
      }
      if (!response.ok || response.redirected) {
        void response.body?.cancel().catch(() => undefined);
        const message = response.status === 401 ? 'OpenAI rejected the image API credential.'
          : response.status === 403 ? 'The OpenAI project does not have access to the selected image model; check model access and organization verification.'
          : response.status === 429 ? 'The OpenAI image API quota or rate limit was reached.'
          : response.status === 404 ? 'The selected OpenAI image model is unavailable for this project.'
          : response.status === 400 ? 'OpenAI rejected the image request. No image was saved.'
          : 'The OpenAI image service failed. No image was saved.';
        throw failure('provider_http_error', message, response.status);
      }
      const reader = response.body?.getReader();
      if (!reader) throw failure('empty_response', 'OpenAI returned no image data.');
      const abort = () => { void reader.cancel().catch(() => undefined); };
      signal.addEventListener('abort', abort, { once: true });
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        if (Number(response.headers.get('content-length')) > responseLimit) throw new Error('size');
        for (;;) {
          signal.throwIfAborted();
          const { done, value } = await reader.read();
          signal.throwIfAborted();
          if (done) break;
          length += value.byteLength;
          if (length > responseLimit) throw new Error('size');
          chunks.push(value);
        }
        const result: unknown = JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
        if (!result || typeof result !== 'object' || !('data' in result) ||
            !Array.isArray(result.data) || result.data.length !== 1) throw new Error('shape');
        const encoded: unknown = result.data[0]?.b64_json;
        if (typeof encoded !== 'string' || !encoded || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) throw new Error('encoding');
        const bytes = Buffer.from(encoded, 'base64');
        if (bytes.toString('base64') !== encoded || bytes.length > workspaceImageSizeLimit) throw new Error('encoding');
        const image = sharp(bytes, { failOn: 'error', limitInputPixels: 16 * 1024 * 1024 });
        const metadata = await image.metadata();
        if (metadata.format !== 'png' || !metadata.width || !metadata.height ||
            metadata.width > 4096 || metadata.height > 4096 || (metadata.pages ?? 1) !== 1) throw new Error('format');
        // Fully decode before saving; retain the original PNG, including provenance metadata.
        await image.raw().toBuffer();
        signal.throwIfAborted();
        return { contentType: 'image/png', bytes };
      } catch {
        void reader.cancel().catch(() => undefined);
        signal.throwIfAborted();
        throw failure('invalid_image_response', 'OpenAI did not return a valid image within the supported size. No image was saved.');
      } finally {
        signal.removeEventListener('abort', abort);
        reader.releaseLock();
      }
    },
  };
}
