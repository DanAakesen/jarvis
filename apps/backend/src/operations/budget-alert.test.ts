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
          timeGrain: 'Monthly',
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
      timeGrain: 'Monthly',
    });
    expect(getToken).toHaveBeenCalledWith('https://management.azure.com/.default', expect.any(AbortSignal));
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('keys 80 percent alerts to the current UTC calendar month, not the activation date', async () => {
    const reader = { read: vi.fn(async () => ({
      amount: 300, currentSpend: 240, periodStart: '2026-10-01T00:00:00Z', timeGrain: 'Monthly',
    })) };
    const alerts = { record: vi.fn(async () => true) };
    const now = () => new Date('2026-11-01T00:00:00.000Z');

    await expect(recordBudgetThresholdIfReached(reader, alerts, new AbortController().signal, now)).resolves.toBe(true);
    expect(alerts.record).toHaveBeenCalledExactlyOnceWith({
      type: 'budget_threshold',
      dedupeKey: 'budget-80:2026-11',
      title: 'Monthly Azure budget reached 80%',
      link: null,
    });
  });

  it('uses UTC month boundaries including year rollover', async () => {
    const reader = {
      read: vi.fn(async () => ({
        amount: 300, currentSpend: 240, periodStart: '2026-10-01T00:00:00Z', timeGrain: 'Monthly',
      })),
    };
    const alerts = { record: vi.fn(async () => true) };

    for (const [instant, period] of [
      ['2026-10-31T23:59:59.999Z', '2026-10'],
      ['2026-11-01T00:00:00.000Z', '2026-11'],
      ['2026-12-31T23:59:59.999Z', '2026-12'],
      ['2027-01-01T00:00:00.000Z', '2027-01'],
    ]) {
      await recordBudgetThresholdIfReached(reader, alerts, new AbortController().signal, () => new Date(instant));
      expect(alerts.record.mock.calls.at(-1)?.[0].dedupeKey).toBe(`budget-80:${period}`);
    }
  });

  it('does not record below threshold and rejects malformed or unsupported Azure periods', async () => {
    const alerts = { record: vi.fn(async () => true) };
    await expect(recordBudgetThresholdIfReached(
      { read: async () => ({
        amount: 300, currentSpend: 239.99, periodStart: '2026-10-01T00:00:00Z', timeGrain: 'Monthly',
      }) },
      alerts,
      new AbortController().signal,
    )).resolves.toBe(false);
    expect(alerts.record).not.toHaveBeenCalled();
    await expect(recordBudgetThresholdIfReached(
      { read: async () => ({
        amount: 300, currentSpend: 240, periodStart: '2026-10-01T00:00:00Z', timeGrain: 'Quarterly',
      }) },
      alerts,
      new AbortController().signal,
      () => new Date('2026-11-01T00:00:00Z'),
    )).rejects.toThrow('Azure budget period was unsupported');
    await expect(recordBudgetThresholdIfReached(
      { read: async () => ({
        amount: 300, currentSpend: 240, periodStart: '2026-12-01T00:00:00Z', timeGrain: 'Monthly',
      }) },
      alerts,
      new AbortController().signal,
      () => new Date('2026-11-30T23:59:59.999Z'),
    )).rejects.toThrow('Azure budget period was invalid');
    expect(alerts.record).not.toHaveBeenCalled();

    const malformed = createArmBudgetReader({
      resourceId,
      getToken: async () => 'fake-token',
      fetcher: vi.fn(async () => new Response(JSON.stringify({
        properties: {
          amount: 300,
          currentSpend: { amount: 240 },
          timeGrain: 'Monthly',
          timePeriod: { startDate: 'not-a-date' },
        },
      }), { status: 200 })),
    });
    await expect(malformed.read(new AbortController().signal)).rejects.toThrow('Azure budget response was incomplete');

    const unsupported = createArmBudgetReader({
      resourceId,
      getToken: async () => 'fake-token',
      fetcher: vi.fn(async () => new Response(JSON.stringify({
        properties: {
          amount: 300,
          currentSpend: { amount: 240 },
          timeGrain: 'Quarterly',
          timePeriod: { startDate: '2026-10-01T00:00:00Z' },
        },
      }), { status: 200 })),
    });
    await expect(unsupported.read(new AbortController().signal)).rejects.toThrow('Azure budget period was unsupported');

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

  it('passes bounded HTTP failure metadata to the monitor error callback', async () => {
    const reader = createArmBudgetReader({
      resourceId,
      getToken: async () => 'fake-token',
      fetcher: vi.fn(async () => new Response('private provider body', { status: 403 })),
    });
    const onError = vi.fn();
    const stop = startBudgetAlertMonitor(reader, { record: vi.fn(async () => true) }, onError);
    try {
      await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
      const error = onError.mock.calls[0]![0];
      expect(error).toMatchObject({ message: 'Azure budget request failed', kind: 'http', statusCode: 403 });
      expect(JSON.stringify(error)).not.toContain('private');
    } finally {
      await stop();
    }
  });
});
