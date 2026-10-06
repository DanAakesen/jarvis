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
        max_tokens?: number;
        max_completion_tokens?: number;
        reasoning_effort?: string;
        messages: { content: { type: string; image_url?: { url: string; detail?: string } }[] }[];
      };
      expect(request.model).toBe('gpt-6-luna');
      expect(request.max_tokens).toBeUndefined();
      expect(request.max_completion_tokens).toBe(500);
      expect(request.reasoning_effort).toBe('none');
      expect(request.messages[0]?.content[1]?.image_url?.url).toMatch(/^data:image\/jpeg;base64,/u);
      expect(request.messages[0]?.content[1]?.image_url?.detail).toBe('auto');
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'A browser window with a chart.' } }],
        usage: { prompt_tokens: 1136, completion_tokens: 26 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const model = createFoundryScreenVisionModel(
      'https://test.services.ai.azure.com/api/projects/jarvis',
      getToken,
      fetcher,
    );

    await expect(model.describe({
      image: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      model: 'gpt-6-luna',
      signal: new AbortController().signal,
    })).resolves.toEqual({
      description: 'A browser window with a chart.',
      inputTokens: 1136,
      outputTokens: 26,
      costDkk: 0.0008,
    });
    expect(getToken).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
