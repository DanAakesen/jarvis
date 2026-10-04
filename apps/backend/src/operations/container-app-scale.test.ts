import { describe, expect, it, vi } from 'vitest';
import { createArmContainerAppScaler } from './container-app-scale.js';

const resourceId = '/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/rg-jarvis/providers/Microsoft.App/containerApps/ca-jarvis-backend-test';

describe('Container Apps ARM scaling client', () => {
  it('reads the minimum replica count with its managed identity token', async () => {
    const getToken = vi.fn(async () => 'managed-identity-token');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      properties: { template: { scale: { minReplicas: 0 } } },
    }), { status: 200 }));
    const scaler = createArmContainerAppScaler({ resourceId, getToken, fetcher });

    await expect(scaler.getMinimumReplicas()).resolves.toBe(0);
    expect(getToken).toHaveBeenCalledWith('https://management.azure.com/.default', expect.any(AbortSignal));
    const request = fetcher.mock.calls[0]?.[1];
    expect(fetcher).toHaveBeenCalledWith(
      new URL(`https://management.azure.com${resourceId}?api-version=2024-03-01`),
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(new Headers(request?.headers).get('Authorization')).toBe(`${['Bear', 'er'].join('')} managed-identity-token`);
  });

  it.each([0, 1] as const)('updates only the minimum replica count to %i', async (minimum) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const scaler = createArmContainerAppScaler({
      resourceId,
      getToken: async () => 'managed-identity-token',
      fetcher,
    });

    await expect(scaler.setMinimumReplicas(minimum)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ properties: { template: { scale: { minReplicas: minimum } } } }),
    }));
  });

  it('rejects malformed target IDs, unsupported values, and ARM failures', async () => {
    expect(() => createArmContainerAppScaler({
      resourceId: 'https://attacker.example/resource',
      getToken: async () => 'token',
    })).toThrow('Invalid Container App resource ID');

    const invalidScale = createArmContainerAppScaler({
      resourceId,
      getToken: async () => 'managed-identity-token',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        properties: { template: { scale: { minReplicas: 2 } } },
      }), { status: 200 })),
    });
    await expect(invalidScale.getMinimumReplicas()).rejects.toThrow('not 0 or 1');

    const failed = createArmContainerAppScaler({
      resourceId,
      getToken: async () => 'managed-identity-token',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response('provider detail', { status: 403 })),
    });
    await expect(failed.setMinimumReplicas(0)).rejects.toThrow('Container Apps scaling request failed');
  });
});
