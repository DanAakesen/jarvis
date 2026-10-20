import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  draftText, loadTrainingTargets, parseTrainingDraft, parseTrainingTargets, saveTrainingTargets,
  trainingTargetChanges, trainingTargetKeys, trainingTargetsFailureMessage, TrainingTargetsError,
  readTarget, useTrainingTargets,
} from './training-targets';

const bounds = {
  gymSessionsPerWeek: { label: 'Gym sessions', unit: 'sessions/week', min: 0, max: 21 },
  runSessionsPerWeek: { label: 'Run sessions', unit: 'sessions/week', min: 0, max: 21 },
  dailySteps: { label: 'Steps per day', unit: 'steps/day', min: 0, max: 100_000 },
};
const synthetic = { gymSessionsPerWeek: 3, runSessionsPerWeek: 2, dailySteps: 8_000 };
const timestamp = '2026-10-17T10:00:00.000Z';
const getAccessToken = vi.fn(async () => 'synthetic-access-token');
const fetchMock = vi.fn<typeof fetch>();

function reply(overrides: Record<string, unknown> = {}) {
  return {
    targets: synthetic, missing: [], updatedAt: timestamp, bounds, ...overrides,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  fetchMock.mockReset();
  getAccessToken.mockReset().mockResolvedValue('synthetic-access-token');
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('parseTrainingTargets', () => {
  it('reads server values and derives the missing list', () => {
    expect(parseTrainingTargets(reply({
      targets: { ...synthetic, runSessionsPerWeek: null },
      missing: ['runSessionsPerWeek'],
    }))).toMatchObject({
      targets: { gymSessionsPerWeek: 3, runSessionsPerWeek: null, dailySteps: 8_000 },
      missing: ['runSessionsPerWeek'], updatedAt: timestamp, bounds,
    });
  });

  it.each([
    ['not an object', 'text'],
    ['array', []],
    ['missing a target', reply({ targets: { gymSessionsPerWeek: 3, dailySteps: 8_000 } })],
    ['extra target key', reply({ targets: { ...synthetic, unexpected: 1 } })],
    ['missing target bounds', reply({ bounds: { gymSessionsPerWeek: bounds.gymSessionsPerWeek, runSessionsPerWeek: bounds.runSessionsPerWeek } })],
    ['numeric string', reply({ targets: { ...synthetic, gymSessionsPerWeek: '3' } })],
    ['fractional target', reply({ targets: { ...synthetic, dailySteps: 8_000.5 } })],
    ['target outside bound', reply({ targets: { ...synthetic, runSessionsPerWeek: 22 } })],
    ['wrong missing list', reply({ missing: ['dailySteps'] })],
    ['missing timestamp', reply({ updatedAt: undefined })],
    ['noncanonical timestamp', reply({ updatedAt: 'yesterday' })],
  ])('rejects an off-contract %s reply', (_label, value) => {
    expect(parseTrainingTargets(value)).toBeNull();
  });

  it('reads all unset targets with no timestamp', () => {
    const state = parseTrainingTargets(reply({
      targets: { gymSessionsPerWeek: null, runSessionsPerWeek: null, dailySteps: null },
      missing: [...trainingTargetKeys], updatedAt: null,
    }));
    expect(state?.missing).toEqual([...trainingTargetKeys]);
    expect(state?.updatedAt).toBeNull();
  });
});

describe('training target drafts', () => {
  it('treats an empty field as clear and accepts only whole numbers in server bounds', () => {
    expect(parseTrainingDraft('  ', bounds.gymSessionsPerWeek)).toEqual({ ok: true, value: null });
    expect(parseTrainingDraft('3', bounds.gymSessionsPerWeek)).toEqual({ ok: true, value: 3 });
    expect(parseTrainingDraft('0', bounds.dailySteps)).toEqual({ ok: true, value: 0 });
    for (const draft of ['-1', '3.5', '1e3', '100001', 'abc']) {
      expect(parseTrainingDraft(draft, bounds.dailySteps).ok).toBe(false);
    }
    expect(draftText(0)).toBe('0');
    expect(draftText(null)).toBe('');
  });

  it('sends only changed valid fields, including null clears', () => {
    expect(trainingTargetChanges(synthetic, {
      gymSessionsPerWeek: { ok: true, value: 3 },
      runSessionsPerWeek: { ok: true, value: null },
      dailySteps: { ok: false, message: 'invalid' },
    })).toEqual({ runSessionsPerWeek: null });
  });
});

describe('trainingTargetsFailureMessage', () => {
  it('uses local failure copy without exposing numbers or server text', () => {
    for (const kind of ['unavailable', 'denied', 'rejected', 'invalid', 'failed'] as const) {
      for (const action of ['load', 'save'] as const) {
        expect(trainingTargetsFailureMessage(kind, action)).not.toMatch(/\d/u);
      }
    }
    expect(trainingTargetsFailureMessage('denied', 'save')).toContain('change');
    expect(trainingTargetsFailureMessage('invalid', 'save')).toContain('Reload Settings');
    expect(trainingTargetsFailureMessage('failed', 'save')).toContain('entries are kept');
  });
});

describe('training target requests', () => {
  const signal = () => new AbortController().signal;

  it('loads uncached targets and saves a partial JSON patch', async () => {
    fetchMock.mockResolvedValueOnce(json(reply())).mockResolvedValueOnce(json(reply({
      targets: { ...synthetic, dailySteps: 9_000 },
    })));
    expect((await loadTrainingTargets('https://api.example.com/', getAccessToken, signal())).targets).toEqual(synthetic);
    expect(await saveTrainingTargets('https://api.example.com', getAccessToken, { dailySteps: 9_000 }, signal()))
      .toMatchObject({ targets: { dailySteps: 9_000 } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/daily/training-targets');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', cache: 'no-store' });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH', body: '{"dailySteps":9000}' });
  });

  it('maps denied, rejected, unavailable and invalid responses to distinct failure kinds', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 403)).mockResolvedValueOnce(json({}, 400))
      .mockResolvedValueOnce(json({}, 404)).mockResolvedValueOnce(json({ targets: {} }));
    const failures: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const error = await loadTrainingTargets('https://api.example.com', getAccessToken, signal())
        .then(() => null, (reason: unknown) => reason);
      failures.push(error instanceof TrainingTargetsError ? error.kind : 'other');
    }
    expect(failures).toEqual(['denied', 'failed', 'unavailable', 'invalid']);
    fetchMock.mockResolvedValueOnce(json({}, 400));
    await expect(saveTrainingTargets('https://api.example.com', getAccessToken, { dailySteps: 9_000 }, signal()))
      .rejects.toMatchObject({ kind: 'rejected' });
  });

  it('fails clearly when no backend or token is available', async () => {
    await expect(loadTrainingTargets(null, getAccessToken, signal())).rejects.toMatchObject({ kind: 'unavailable' });
    getAccessToken.mockRejectedValueOnce(new Error('expired'));
    await expect(loadTrainingTargets('https://api.example.com', getAccessToken, signal())).rejects.toMatchObject({ kind: 'denied' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useTrainingTargets', () => {
  it('moves from loading to settled and retries a failed read', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json(reply()));
    const { result } = renderHook(() => useTrainingTargets('https://api.example.com', getAccessToken));
    expect(result.current.view.status).toBe('loading');
    await waitFor(() => expect(result.current.view).toMatchObject({ status: 'error', kind: 'failed' }));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.view).toMatchObject({ status: 'settled', state: { targets: synthetic } }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns the unavailable state without a request when disabled', async () => {
    const { result } = renderHook(() => useTrainingTargets(null, getAccessToken, false));
    await waitFor(() => expect(result.current.view).toMatchObject({ status: 'error', kind: 'unavailable' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('takes a state the server just returned without another read', async () => {
    fetchMock.mockResolvedValueOnce(json(reply()));
    const { result } = renderHook(() => useTrainingTargets('https://api.example.com', getAccessToken));
    await waitFor(() => expect(result.current.view.status).toBe('settled'));
    const saved = parseTrainingTargets(reply({ targets: { ...synthetic, gymSessionsPerWeek: 5 } }))!;
    act(() => result.current.apply(saved));
    expect(result.current.view).toMatchObject({ status: 'settled', state: { targets: { gymSessionsPerWeek: 5 } } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('readTarget', () => {
  const settled = { status: 'settled', state: parseTrainingTargets(reply({ targets: { ...synthetic, runSessionsPerWeek: null }, missing: ['runSessionsPerWeek'] }))! } as const;

  it('reads loading, failed, set and not-set targets as different things', () => {
    expect(readTarget({ status: 'loading' }, 'gymSessionsPerWeek')).toEqual({ status: 'loading' });
    expect(readTarget({ status: 'error', kind: 'unavailable', message: 'x' }, 'gymSessionsPerWeek')).toEqual({ status: 'failed' });
    expect(readTarget(settled, 'gymSessionsPerWeek')).toEqual({ status: 'ready', value: 3 });
    expect(readTarget(settled, 'runSessionsPerWeek')).toEqual({ status: 'ready', value: null });
  });
});
