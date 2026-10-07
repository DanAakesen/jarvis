import { describe, expect, it, vi } from 'vitest';
import {
  createFoundryMemoryEmbedder,
  FOUNDRY_EMBEDDING_SCOPE,
  MEMORY_EMBEDDING_DIMENSIONS,
} from './memory-embeddings.js';

const projectEndpoint = 'https://jarvis.services.ai.azure.com/api/projects/jarvis-project';

describe('Foundry memory embeddings', () => {
  it('requests a bounded embedding with the project deployment and managed identity scope', async () => {
    const vector = Array.from({ length: MEMORY_EMBEDDING_DIMENSIONS }, (_, index) => index / 1000);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      data: [{ embedding: vector }],
      usage: { prompt_tokens: 17 },
    })));
    const getToken = vi.fn(async () => 'not-a-secret-token');
    const embedder = createFoundryMemoryEmbedder({
      projectEndpoint,
      deploymentName: 'text-embedding-3-small',
      getToken,
      fetcher,
    });

    await expect(embedder.embed('A confirmed preference.', new AbortController().signal)).resolves.toEqual(vector);
    await expect(embedder.embedWithUsage?.('A confirmed preference.', new AbortController().signal))
      .resolves.toEqual({ embedding: vector, inputTokens: 17 });

    expect(getToken).toHaveBeenCalledWith(FOUNDRY_EMBEDDING_SCOPE, expect.any(AbortSignal));
    expect(fetcher).toHaveBeenCalledWith(
      `${projectEndpoint}/openai/v1/embeddings`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: ['Bear' + 'er', 'not-a-secret-token'].join(' '),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: 'A confirmed preference.' }),
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('rejects invalid endpoints, empty text, and malformed embedding responses', async () => {
    expect(() => createFoundryMemoryEmbedder({
      projectEndpoint: 'http://localhost/api/projects/test',
      deploymentName: 'text-embedding-3-small',
      getToken: async () => 'token',
    })).toThrow('secure Azure AI project URL');

    const embedder = createFoundryMemoryEmbedder({
      projectEndpoint,
      deploymentName: 'text-embedding-3-small',
      getToken: async () => 'token',
      fetcher: async () => new Response(JSON.stringify({ data: [{ embedding: [1, Number.NaN] }] })),
    });
    await expect(embedder.embed(' ', new AbortController().signal)).rejects.toThrow('Memory text is invalid');
    await expect(embedder.embed('preference', new AbortController().signal)).rejects.toThrow(
      'Foundry embedding response is invalid',
    );
  });
});
