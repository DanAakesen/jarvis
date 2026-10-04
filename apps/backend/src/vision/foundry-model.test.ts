import { describe, expect, it, vi } from 'vitest';
import { createFoundryScreenVisionModel } from './foundry-model.js';

describe('Foundry screen vision model', () => {
  it('uses the managed-identity token and returns bounded description and token usage', async () => {
    const getToken = vi.fn(async (scope: string) => {
      expect(scope).toBe('https://ai.azure.com/.default');
      return 'managed-identity-token';
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new URL(String(input)).pathname).toBe('/models/chat/completions');
      expect(new Headers(init?.headers).get('authorization')).toBe(
        ['Bearer', 'managed-identity-token'].join(' '),
      );
      const request = JSON.parse(String(init?.body)) as {
        model: string;
        messages: { content: { type: string; image_url?: { url: string } }[] }[];
      };
      expect(request.model).toBe('gpt-5.6-luna');
      expect(request.messages[0]?.content[1]?.image_url?.url).toMatch(/^data:image\/jpeg;base64,/u);
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'A browser window with a chart.' } }],
        usage: { prompt_tokens: 100, completion_tokens: 8 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const model = createFoundryScreenVisionModel(
      'https://test.services.ai.azure.com/api/projects/jarvis',
      getToken,
      fetcher,
    );

    await expect(model.describe({
      image: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      model: 'gpt-5.6-luna',
      signal: new AbortController().signal,
    })).resolves.toEqual({
      description: 'A browser window with a chart.',
      inputTokens: 100,
      outputTokens: 8,
    });
    expect(getToken).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
