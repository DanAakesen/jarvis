import { describe, expect, it, vi } from 'vitest';
import {
  codexModels, copilotModels, createArmModelCatalogueReader, fallbackModelCatalogue, isRoleModelSupported,
  modelsForRole, reasoningForModel,
  visionModelRatesDkkPerMillionTokens,
} from './model-catalog.js';

const resourceId = '/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/rg-jarvis/providers/Microsoft.CognitiveServices/accounts/jarvis-prod';

const armDeployment = {
  name: 'gpt-6-luna',
  sku: { name: 'GlobalStandard', capacity: 50 },
  properties: {
    model: {
      name: 'gpt-6-luna',
      version: '2026-09-22',
      capabilities: { chatCompletion: 'true', vision: 'true', reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
    },
  },
};

describe('Foundry model catalogue', () => {
  it('reads live ARM deployments and caches the normalized result for five minutes', async () => {
    let time = 1_000;
    const getToken = vi.fn(async () => 'managed-identity-token');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ value: [armDeployment] })));
    const reader = createArmModelCatalogueReader({
      resourceId,
      getToken,
      fetcher,
      now: () => time,
    });

    const catalogue = await reader.read();
    expect(catalogue).toEqual({
      source: 'arm',
      deployments: [{
        name: 'gpt-6-luna',
        model: 'gpt-6-luna',
        version: '2026-09-22',
        sku: 'GlobalStandard',
        capacity: 50,
        capabilities: ['chat', 'responses', 'image'],
        reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      }],
    });
    expect(getToken).toHaveBeenCalledWith('https://management.azure.com/.default', expect.any(AbortSignal));
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('Authorization'))
      .toContain('managed-identity-token');
    await reader.read();
    expect(fetcher).toHaveBeenCalledTimes(1);

    time += 5 * 60_000;
    await reader.read();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('invalidates the live deployment cache after a deployment change', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [armDeployment] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        value: [{ ...armDeployment, name: 'gpt-6-luna-new' }],
      })));
    const reader = createArmModelCatalogueReader({ resourceId, getToken: async () => 'managed-identity-token', fetcher });

    expect((await reader.read()).deployments[0]?.name).toBe('gpt-6-luna');
    reader.invalidate?.();
    expect((await reader.read()).deployments[0]?.name).toBe('gpt-6-luna-new');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('returns configured deployment defaults and a fallback source when ARM is unavailable', async () => {
    const reader = createArmModelCatalogueReader({
      resourceId,
      getToken: async () => 'managed-identity-token',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 })),
    });

    const catalogue = await reader.read();
    expect(catalogue.source).toBe('fallback');
    expect(catalogue.reason).toContain('configured model defaults');
    expect(catalogue.deployments).toEqual(fallbackModelCatalogue().deployments);
    expect(modelsForRole(catalogue, 'chat')).toContain('gpt-6-luna');
    expect(modelsForRole(catalogue, 'embedding')).toEqual([
      'text-embedding-3-large', 'text-embedding-3-small',
    ]);
    expect(isRoleModelSupported(catalogue, 'chat', 'gpt-6-luna', 'high')).toBe(true);
    expect(isRoleModelSupported(catalogue, 'chat', 'gpt-6-luna', 'xhigh')).toBe(true);
    expect(isRoleModelSupported(catalogue, 'chat', 'gpt-5.6-luna', 'xhigh')).toBe(false);
    expect(modelsForRole(catalogue, 'voice')).toEqual(['gpt-realtime-2.1', 'gpt-realtime-2.1-mini']);
    expect(modelsForRole(catalogue, 'transcription')).toEqual(['mai-transcribe']);
    expect(modelsForRole(catalogue, 'vision').every((model) =>
      visionModelRatesDkkPerMillionTokens.has(model))).toBe(true);
    const unpricedVision = {
      ...catalogue.deployments[0]!,
      name: 'unpriced-vision',
      model: 'unpriced-vision',
      capabilities: ['image'] as const,
    };
    expect(modelsForRole({ ...catalogue, deployments: [...catalogue.deployments, unpricedVision] }, 'vision'))
      .not.toContain('unpriced-vision');
  });

  it('offers provider-supported coding models and their reasoning efforts independently of Foundry deployments', () => {
    const catalogue = fallbackModelCatalogue();

    expect(modelsForRole(catalogue, 'codex')).toEqual(codexModels);
    expect(modelsForRole(catalogue, 'codex')).toContain('gpt-5.3-codex');
    expect(modelsForRole(catalogue, 'copilot')).toEqual(copilotModels);
    expect(modelsForRole(catalogue, 'copilot')).toContain('claude-sonnet-4.6');
    expect(reasoningForModel(catalogue, 'codex', 'gpt-5.5'))
      .toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
    expect(reasoningForModel(catalogue, 'copilot', 'gpt-5.4')).toEqual(['none', 'low', 'medium', 'high']);
    expect(reasoningForModel(catalogue, 'copilot', 'unsupported-model')).toEqual([]);
    expect(isRoleModelSupported(catalogue, 'copilot', 'gpt-5.4', 'high')).toBe(true);
    expect(isRoleModelSupported(catalogue, 'copilot', 'gpt-5.4', 'xhigh')).toBe(false);
  });

  it('rejects unsafe account IDs and pagination targets', async () => {
    expect(() => createArmModelCatalogueReader({
      resourceId: 'https://attacker.example/deployments',
      getToken: async () => 'token',
    })).toThrow('Invalid Foundry account resource ID');
    const reader = createArmModelCatalogueReader({
      resourceId,
      getToken: async () => 'managed-identity-token',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        value: [armDeployment],
        nextLink: 'https://attacker.example/next',
      }))),
    });
    expect((await reader.read()).source).toBe('fallback');
  });
});
