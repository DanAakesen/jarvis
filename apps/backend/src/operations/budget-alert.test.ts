import { describe, expect, it, vi } from 'vitest';
import { createArmBudgetReader, recordBudgetThresholdIfReached, startBudgetAlertMonitor } from './budget-alert.js';

const resourceId = '/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/rg-jarvis/providers/Microsoft.Consumption/budgets/jarvis-monthly';

describe('Azure budget alerts', () => {
  it('reads a bounded authenticated budget response from the expected ARM resource', async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe(`https://management.azure.com${resourceId}?api-version=2019-10-01`);
      expect(init?.headers).toEqual({ Authorization: ['Bear', 'er'].join('') + ' fake-token', Accept: 'application/json' });
      return new Response(JSON.stringify({
        properties: {
          amount: 300,
          currentSpend: { amount: 240, unit: 'DKK' },
          timePeriod: { startDate: '2026-10-01T00:00:00Z' },
        },
      }), { status: 200 });
    });
    const getToken = vi.fn(async () => 'fake-token');
    const reader = createArmBudgetReader({ resourceId, getToken, fetcher: fetcher as typeof fetch });

    await expect(reader.read(new AbortController().signal)).resolves.toEqual({
      amount: 300,
      currentSpend: 240,
      periodStart: '2026-10-01T00:00:00Z',
    });
    expect(getToken).toHaveBeenCalledWith('https://management.azure.com/.default', expect.any(AbortSignal));
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('records one alert at 80 percent, keyed to the budget month', async () => {
    const reader = { read: vi.fn(async () => ({
      amount: 300, currentSpend: 240, periodStart: '2026-10-01T00:00:00Z',
    })) };
    const alerts = { record: vi.fn(async () => true) };

    await expect(recordBudgetThresholdIfReached(reader, alerts, new AbortController().signal)).resolves.toBe(true);
    expect(alerts.record).toHaveBeenCalledExactlyOnceWith({
      type: 'budget_threshold',
      dedupeKey: 'budget-80:2026-10',
      title: 'Monthly Azure budget reached 80%',
      link: null,
    });
  });

  it('does not record below threshold and rejects malformed Azure responses', async () => {
    const alerts = { record: vi.fn(async () => true) };
    await expect(recordBudgetThresholdIfReached(
      { read: async () => ({ amount: 300, currentSpend: 239.99, periodStart: '2026-10-01T00:00:00Z' }) },
      alerts,
      new AbortController().signal,
    )).resolves.toBe(false);
    expect(alerts.record).not.toHaveBeenCalled();
    expect(() => createArmBudgetReader({
      resourceId: 'https://attacker.example/budget',
      getToken: async () => 'token',
    })).toThrow('Invalid Azure budget resource ID');
  });

  it('aborts and awaits an in-flight check during shutdown', async () => {
    let requestSignal: AbortSignal | undefined;
    const reader = {
      read: vi.fn((signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
        requestSignal = signal;
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      })),
    };
    const onError = vi.fn();
    const stop = startBudgetAlertMonitor(reader, { record: vi.fn(async () => true) }, onError);

    await stop();

    expect(reader.read).toHaveBeenCalledOnce();
    expect(requestSignal?.aborted).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });
});
