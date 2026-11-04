import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseTrainingTargets, readTarget, type TrainingTargetsState } from './training-targets';
import { TrainingTargetsProvider } from './TrainingTargetsProvider';
import { useTrainingTargetsShared } from './training-targets-context';

const bounds = {
  gymSessionsPerWeek: { label: 'Gym sessions', unit: 'sessions/week', min: 0, max: 21 },
  runSessionsPerWeek: { label: 'Run sessions', unit: 'sessions/week', min: 0, max: 21 },
  dailySteps: { label: 'Steps per day', unit: 'steps/day', min: 0, max: 100_000 },
};
const targets = { gymSessionsPerWeek: 3, runSessionsPerWeek: null, dailySteps: 8_000 };
const getAccessToken = vi.fn(async () => 'synthetic-access-token');
const fetchMock = vi.fn<typeof fetch>();

function reply(values = targets) {
  const missing = Object.entries(values).filter(([, value]) => value === null).map(([key]) => key);
  return new Response(JSON.stringify({ targets: values, missing, updatedAt: '2026-10-17T10:00:00.000Z', bounds }), { status: 200 });
}

let latest: ReturnType<typeof useTrainingTargetsShared> | null = null;
function Gym({ name }: { name: string }) {
  const shared = useTrainingTargetsShared();
  useEffect(() => { latest = shared; });
  const read = readTarget(shared.view, 'gymSessionsPerWeek');
  return <output aria-label={name}>{read.status === 'ready' ? String(read.value) : read.status}</output>;
}
function Quiet() {
  return <p>No targets shown here</p>;
}
function mount(children = <><Gym name="first" /><Gym name="second" /></>, backendUrl: string | null = 'https://api.example.com') {
  return render(<TrainingTargetsProvider backendUrl={backendUrl} getAccessToken={getAccessToken}>{children}</TrainingTargetsProvider>);
}

beforeEach(() => {
  latest = null;
  fetchMock.mockReset();
  getAccessToken.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('shared training targets', () => {
  it('reads once for every view that shows targets', async () => {
    fetchMock.mockImplementation(async () => reply());
    mount();
    await waitFor(() => expect(screen.getByLabelText('first').textContent).toBe('3'));
    expect(screen.getByLabelText('second').textContent).toBe('3');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not ask for targets while no view shows them', async () => {
    mount(<Quiet />);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows loading until the read returns', async () => {
    let release!: () => void;
    fetchMock.mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); return reply(); });
    mount();
    expect(screen.getByLabelText('first').textContent).toBe('loading');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    release();
    await waitFor(() => expect(screen.getByLabelText('first').textContent).toBe('3'));
  });

  it('shows a failed read as failed and reads again on retry', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 })).mockImplementation(async () => reply());
    mount();
    await waitFor(() => expect(screen.getByLabelText('first').textContent).toBe('failed'));
    act(() => latest?.retry());
    await waitFor(() => expect(screen.getByLabelText('first').textContent).toBe('3'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('follows a saved state in every view without another read', async () => {
    fetchMock.mockImplementation(async () => reply());
    mount();
    await waitFor(() => expect(screen.getByLabelText('first').textContent).toBe('3'));
    const saved = parseTrainingTargets({ targets: { ...targets, gymSessionsPerWeek: 5 }, missing: ['runSessionsPerWeek'],
      updatedAt: '2026-10-18T10:00:00.000Z', bounds }) as TrainingTargetsState;
    act(() => latest?.apply(saved));
    expect(screen.getByLabelText('first').textContent).toBe('5');
    expect(screen.getByLabelText('second').textContent).toBe('5');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads outside a Health area as targets that are not served', () => {
    render(<Gym name="alone" />);
    expect(screen.getByLabelText('alone').textContent).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
