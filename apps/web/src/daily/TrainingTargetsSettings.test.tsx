import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrainingTargetsSettings } from './TrainingTargetsSettings';
import type { TrainingTargetValues } from './training-targets';

const backendUrl = 'https://api.example.com/';
const getAccessToken = vi.fn(async () => 'synthetic-access-token');
const fetchMock = vi.fn<typeof fetch>();
const bounds = {
  gymSessionsPerWeek: { label: 'Gym sessions', unit: 'sessions/week', min: 0, max: 21 },
  runSessionsPerWeek: { label: 'Run sessions', unit: 'sessions/week', min: 0, max: 21 },
  dailySteps: { label: 'Daily steps', unit: 'steps/day', min: 0, max: 100_000 },
};
const configured = { gymSessionsPerWeek: 3, runSessionsPerWeek: 2, dailySteps: 8_000 };
const unset = { gymSessionsPerWeek: null, runSessionsPerWeek: null, dailySteps: null };

function reply(targets: TrainingTargetValues = configured, updatedAt: string | null = '2026-10-17T10:00:00.000Z', status = 200) {
  const missing = Object.entries(targets).filter(([, value]) => value === null).map(([key]) => key);
  return new Response(JSON.stringify({ targets, missing, updatedAt, bounds }), { status });
}

function failure(status: number) {
  return new Response(JSON.stringify({ error: 'Private server detail' }), { status });
}

function renderSettings(url: string | null = backendUrl) {
  return render(<TrainingTargetsSettings backendUrl={url} getAccessToken={getAccessToken} />);
}

function field(label: string) {
  return screen.getByLabelText(label) as HTMLInputElement;
}

function saveButton() {
  return screen.getByRole('button', { name: /^(Save training targets|Saving…)$/u }) as HTMLButtonElement;
}

async function replace(user: ReturnType<typeof userEvent.setup>, label: string, text: string) {
  const input = field(label);
  await user.clear(input);
  if (text) await user.type(input, text);
  return input;
}

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  getAccessToken.mockReset().mockResolvedValue('synthetic-access-token');
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('TrainingTargetsSettings', () => {
  it('renders the own Settings anchor and uses the server labels, units and saved values', async () => {
    fetchMock.mockResolvedValueOnce(reply());
    renderSettings();
    expect(await screen.findByLabelText('Gym sessions (sessions/week)')).not.toBeNull();
    expect(document.getElementById('training-targets')).not.toBeNull();
    expect(field('Gym sessions (sessions/week)').value).toBe('3');
    expect(field('Run sessions (sessions/week)').value).toBe('2');
    expect(field('Daily steps (steps/day)').value).toBe('8000');
    expect(saveButton().disabled).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/daily/training-targets');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', cache: 'no-store' });
  });

  it('keeps unset targets empty with no placeholder or example value', async () => {
    fetchMock.mockResolvedValueOnce(reply(unset, null));
    renderSettings();
    await screen.findByLabelText('Daily steps (steps/day)');
    for (const label of ['Gym sessions (sessions/week)', 'Run sessions (sessions/week)', 'Daily steps (steps/day)']) {
      expect(field(label).value).toBe('');
      expect(field(label).hasAttribute('placeholder')).toBe(false);
    }
    await userEvent.setup().click(screen.getByRole('button', { name: /^Training targets/u }));
    expect(screen.getByText('Needs setup')).not.toBeNull();
  });

  it('sets only the changed field and adopts the saved readback', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply())
      .mockResolvedValueOnce(reply({ ...configured, gymSessionsPerWeek: 4 }));
    renderSettings();
    const gym = await screen.findByLabelText('Gym sessions (sessions/week)') as HTMLInputElement;
    await replace(user, 'Gym sessions (sessions/week)', '4');
    await user.click(saveButton());
    expect(await screen.findByText('Saved')).not.toBeNull();
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH', body: '{"gymSessionsPerWeek":4}' });
    expect(gym.value).toBe('4');
    expect(saveButton().disabled).toBe(true);
  });

  it('clears a target when the field is emptied', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply()).mockResolvedValueOnce(reply({ ...configured, dailySteps: null }));
    renderSettings();
    await screen.findByLabelText('Daily steps (steps/day)');
    await replace(user, 'Daily steps (steps/day)', '');
    await user.click(saveButton());
    expect(await screen.findByText('Saved')).not.toBeNull();
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH', body: '{"dailySteps":null}' });
    expect(field('Daily steps (steps/day)').value).toBe('');
  });

  it('validates before sending and focuses the invalid field', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply());
    renderSettings();
    await screen.findByLabelText('Daily steps (steps/day)');
    const gym = await replace(user, 'Gym sessions (sessions/week)', '22');
    await user.click(saveButton());
    expect(await screen.findByText('Gym sessions: enter a whole number from 0 to 21 sessions/week, or leave it empty.')).not.toBeNull();
    expect(gym.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(gym);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, 'Training targets are private to the Jarvis owner. Sign in as the owner to change them.'],
    [503, 'Training targets could not be saved. Your entries are kept: save again, or reload Settings to see what is stored.'],
  ])('keeps the draft and shows local copy after a denied or failed save (%i)', async (status, message) => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply()).mockResolvedValueOnce(failure(status));
    renderSettings();
    await screen.findByLabelText('Daily steps (steps/day)');
    const steps = await replace(user, 'Daily steps (steps/day)', '9000');
    await user.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(screen.queryByText('Private server detail')).toBeNull();
    expect(steps.value).toBe('9000');
  });

  it('shows unavailable without retry when the route does not exist or no backend is configured', async () => {
    fetchMock.mockResolvedValueOnce(failure(404));
    renderSettings();
    expect(await screen.findByText('Training targets are not available here.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    renderSettings(null);
    expect(await screen.findAllByText('Training targets are not available here.')).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('offers a retry after a failed read and never renders the server response', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(failure(502)).mockResolvedValueOnce(reply());
    renderSettings();
    expect((await screen.findByRole('alert')).textContent).toBe('Training targets could not be loaded. Try again.');
    expect(screen.queryByText('Private server detail')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText('Gym sessions (sessions/week)')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending read when the Settings section unmounts', async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const view = renderSettings();
    await screen.findByText('Loading training targets…');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolve(reply()); });
  });
});
