import { describe,expect,it,vi } from 'vitest';
import { createFoundryMailSemanticModel } from './foundry-model.js';
import { semantic } from './gmail.js';
import { fallbackModelCatalogue } from '../../core/model-catalog.js';
import type { SettingsStore } from '../../core/settings.js';
import type { UsageStore } from '../../core/usage.js';

const endpoint = 'https://synthetic.services.ai.azure.com/api/projects/synthetic';
const data = { threadId: '01',subject: 'Synthetic question',messages: [{ messageId: '01',direction: 'incoming' as const,sender: 'sender@example.invalid',body: 'Synthetic untrusted message',sentAt: '2026-10-10T10:00:00Z' }] };
const classification = { semanticState: 'new_question',semanticEvidence: 'Synthetic factual question',senderIsHuman: true,excludedCategory: null,sentRequestAt: null,waitingSince: null };
function fixture(response: unknown = { choices: [{ finish_reason: 'stop',message: { content: JSON.stringify(classification) } }],usage: { prompt_tokens: 123,completion_tokens: 80 } }) {
  const getToken = vi.fn(async (scope: string, signal: AbortSignal) => { expect(scope).toBe('https://ai.azure.com/.default'); signal.throwIfAborted(); return 'synthetic-test-token'; });
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response),{ status: 200 }));
  const recordFoundryUsage = vi.fn(async () => undefined);
  const settings = { read: async () => ({ 'roles.chat.model': '"gpt-6-luna"','roles.chat.reasoning_effort': '"low"' }) } as SettingsStore;
  const catalogue = { read: async () => fallbackModelCatalogue() };
  const model = createFoundryMailSemanticModel(endpoint,getToken,settings,catalogue,{ recordFoundryUsage } as unknown as UsageStore,fetcher);
  return { model,getToken,fetcher,recordFoundryUsage,settings,catalogue };
}
const signal = () => new AbortController().signal;
describe('existing-identity tool-free Foundry mail boundary', () => {
  it('uses canonical chat settings, existing endpoint/scope and completion token contract; accounts without mail', async () => {
    const f = fixture(); expect(await semantic(f.model,'attention',data,signal())).toEqual(classification);
    expect(f.getToken.mock.calls[0]?.[0]).toBe('https://ai.azure.com/.default');
    const [url,options] = f.fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://synthetic.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview');
    expect(options).toMatchObject({ method: 'POST',redirect: 'error' });
    const body = JSON.parse(options!.body as string);
    expect(body).toMatchObject({ model: 'gpt-6-luna',reasoning_effort: 'low',max_completion_tokens: 1024,response_format: { type: 'json_object' } });
    expect(body.tools).toBeUndefined(); expect(body.max_tokens).toBeUndefined(); expect(body.messages[0].content).toContain('additionalProperties');
    expect(f.recordFoundryUsage).toHaveBeenCalledWith({ role: 'chat',model: 'gpt-6-luna',inputTokens: 123,outputTokens: 80,eventId: expect.any(String) });
    expect(JSON.stringify(f.recordFoundryUsage.mock.calls)).not.toContain('Synthetic untrusted');
    expect(await f.model.cacheIdentity!()).toContain('gpt-6-luna');
  });
  it.each([
    { choices: [{ finish_reason: 'length',message: { content: '{}' } }],usage: { prompt_tokens: 12,completion_tokens: 1024 } },
    { choices: [{ finish_reason: 'stop',message: { content: '{}',tool_calls: [] } }],usage: { prompt_tokens: 12,completion_tokens: 3 } },
    { choices: [{ finish_reason: 'stop',message: { content: '{}',refusal: 'Synthetic refusal' } }],usage: { prompt_tokens: 12,completion_tokens: 3 } },
    { choices: [{ finish_reason: 'stop',message: { content: 'not-json' } }],usage: { prompt_tokens: 12,completion_tokens: 3 } },
    { choices: [{ finish_reason: 'stop',message: { content: JSON.stringify({ ...classification,waitingSince: '2020-01-01T00:00:00Z' }) } }],usage: { prompt_tokens: 12,completion_tokens: 3 } },
  ])('fails closed for truncation, actions, refusal, malformed or invented output %#', async (response) => {
    const f = fixture(response); await expect(semantic(f.model,'attention',data,signal())).rejects.toThrow();
    expect(f.recordFoundryUsage).toHaveBeenCalledTimes(1);
  });
  it('rejects absent usage, oversized streamed responses and sanitized provider failures', async () => {
    const f = fixture({ choices: [] }); await expect(semantic(f.model,'attention',data,signal())).rejects.toThrow('capability unavailable');
    expect(f.recordFoundryUsage).not.toHaveBeenCalled();
    f.fetcher.mockImplementationOnce(async () => new Response('界'.repeat(12000)));
    await expect(semantic(f.model,'attention',data,signal())).rejects.toThrow('capability unavailable');
    f.fetcher.mockRejectedValueOnce(new Error('Synthetic private body/token'));
    await expect(semantic(f.model,'attention',data,signal())).rejects.toThrow('capability unavailable');
  });
  it('does not invoke a model without supported catalogue, pricing and usage accounting', async () => {
    const f = fixture(); f.catalogue.read = async () => ({ ...fallbackModelCatalogue(),deployments: [] });
    await expect(semantic(f.model,'attention',data,signal())).rejects.toThrow('capability unavailable'); expect(f.fetcher).not.toHaveBeenCalled();
    const noUsage = createFoundryMailSemanticModel(endpoint,f.getToken,f.settings,{ read: async () => fallbackModelCatalogue() },{} as UsageStore,f.fetcher);
    await expect(semantic(noUsage,'attention',data,signal())).rejects.toThrow('capability unavailable'); expect(f.fetcher).not.toHaveBeenCalled();
    expect(() => createFoundryMailSemanticModel('https://untrusted.invalid/api/projects/test',f.getToken,f.settings,f.catalogue,{} as UsageStore)).toThrow();
  });
  it('propagates cancellation without fetching and bounds calls to fifty per minute', async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort(new Error('Synthetic cancellation'));
    await expect(semantic(f.model,'attention',data,controller.signal)).rejects.toThrow('Synthetic cancellation'); expect(f.fetcher).not.toHaveBeenCalled();
    for (let i = 0; i < 50; i++) await semantic(f.model,'attention',data,signal());
    await expect(semantic(f.model,'attention',data,signal())).rejects.toThrow('capability unavailable'); expect(f.fetcher).toHaveBeenCalledTimes(50);
  });
  it('cancels a pending canonical selection without acquiring a token or making a model request', async () => {
    const f = fixture(); f.settings.read = () => new Promise(() => undefined);
    const controller = new AbortController();
    const identity = f.model.cacheIdentity!(controller.signal); controller.abort(new Error('Synthetic selection cancellation'));
    await expect(identity).rejects.toThrow('Synthetic selection cancellation');
    expect(f.getToken).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
  });
});
