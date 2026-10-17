import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NutritionTargetsSettings } from './NutritionTargetsSettings';

const backendUrl = 'https://api.example.com/';
const getAccessToken = vi.fn(async () => ['access', 'fixture'].join('.'));
const fetchMock = vi.fn<typeof fetch>();

interface Targets { restingKcal: number | null; deficitKcal: number | null; proteinGrams: number | null }

const bounds = {
  restingKcal: { label: 'Resting energy burn', unit: 'kcal', min: 1000, max: 4000 },
  deficitKcal: { label: 'Daily deficit', unit: 'kcal', min: 0, max: 2000 },
  proteinGrams: { label: 'Protein target', unit: 'g', min: 30, max: 400 },
};
const filled: Targets = { restingKcal: 1750, deficitKcal: 350, proteinGrams: 110 };
const unset: Targets = { restingKcal: null, deficitKcal: null, proteinGrams: null };
const savedAt = '2026-10-17T09:30:00.000Z';

function reply(targets: Targets = filled, updatedAt: string | null = savedAt, status = 200) {
  const missing = Object.entries(targets).filter(([, value]) => value === null).map(([key]) => key);
  return new Response(JSON.stringify({ targets, missing, updatedAt, bounds }), { status });
}

function failure(status: number) {
  return new Response(JSON.stringify({ error: 'Private server detail' }), { status });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function renderSettings(url: string | null = backendUrl) {
  return render(<NutritionTargetsSettings backendUrl={url} getAccessToken={getAccessToken} />);
}

function field(label: string) {
  return screen.getByLabelText(label) as HTMLInputElement;
}

function saveButton() {
  return screen.getByRole('button', { name: /^(Save nutrition targets|Saving…)$/u }) as HTMLButtonElement;
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
  getAccessToken.mockReset().mockResolvedValue(['access', 'fixture'].join('.'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('NutritionTargetsSettings', () => {
  it('loads the stored targets as an authenticated, uncached owner read and says when they were saved', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    renderSettings();
    expect(await screen.findByText('Loading nutrition targets…')).not.toBeNull();
    await act(async () => { pending.resolve(reply()); });
    expect(await screen.findByLabelText('Resting energy burn (kcal)')).not.toBeNull();
    expect(field('Resting energy burn (kcal)').value).toBe('1750');
    expect(field('Daily deficit (kcal)').value).toBe('350');
    expect(field('Protein target (g)').value).toBe('110');
    expect(screen.getByText(/Whole number from 1000 to 4000 kcal\./u)).not.toBeNull();
    expect(screen.getByText(/^Last saved .+\.$/u)).not.toBeNull();
    expect(screen.queryByText(/Not set yet/u)).toBeNull();
    expect(saveButton().disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/daily/nutrition-targets');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      headers: { Authorization: `${['Bear', 'er'].join('')} ${await getAccessToken()}` },
    });
  });

  it('ships no default, placeholder or example figure when nothing is set', async () => {
    fetchMock.mockResolvedValueOnce(reply(unset, null));
    renderSettings();
    await screen.findByLabelText('Resting energy burn (kcal)');
    for (const label of ['Resting energy burn (kcal)', 'Daily deficit (kcal)', 'Protein target (g)']) {
      expect(field(label).value).toBe('');
      expect(field(label).hasAttribute('placeholder')).toBe(false);
    }
    expect(screen.getByText(/Not set yet: Resting energy burn, Daily deficit, Protein target\./u)).not.toBeNull();
    expect(screen.queryByText(/Last saved/u)).toBeNull();
    expect(saveButton().disabled).toBe(true);
  });

  it('shows the state in the folded summary', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(unset, null));
    const view = renderSettings();
    await screen.findByLabelText('Resting energy burn (kcal)');
    const toggle = screen.getByRole('button', { name: /^Nutrition targets/u });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('Needs setup')).not.toBeNull();
    view.unmount();

    fetchMock.mockResolvedValueOnce(reply());
    localStorage.clear();
    renderSettings();
    await screen.findByLabelText('Resting energy burn (kcal)');
    await user.click(screen.getByRole('button', { name: /^Nutrition targets/u }));
    expect(screen.getByText('Configured')).not.toBeNull();
  });

  it('sends only what changed, adopts the committed readback and clears the notice on the next edit', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply())
      .mockResolvedValueOnce(reply({ ...filled, restingKcal: 1800 }, '2026-10-17T10:00:00.000Z'));
    renderSettings();
    await screen.findByLabelText('Resting energy burn (kcal)');
    const resting = await replace(user, 'Resting energy burn (kcal)', '1800');
    expect(saveButton().disabled).toBe(false);
    await user.click(saveButton());
    expect(await screen.findByText('Nutrition targets saved.')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.example.com/daily/nutrition-targets');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'PATCH',
      cache: 'no-store',
      body: '{"restingKcal":1800}',
      headers: {
        Authorization: `${['Bear', 'er'].join('')} ${await getAccessToken()}`,
        'Content-Type': 'application/json',
      },
    });
    expect(resting.value).toBe('1800');
    expect(saveButton().disabled).toBe(true);
    await user.type(resting, '1');
    expect(screen.queryByText('Nutrition targets saved.')).toBeNull();
  });

  it('clears a target when its field is emptied and nothing else is sent', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply())
      .mockResolvedValueOnce(reply({ ...filled, proteinGrams: null }));
    renderSettings();
    await screen.findByLabelText('Protein target (g)');
    await replace(user, 'Protein target (g)', '');
    await user.click(saveButton());
    expect(await screen.findByText('Nutrition targets saved.')).not.toBeNull();
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH', body: '{"proteinGrams":null}' });
    expect(field('Protein target (g)').value).toBe('');
    expect(screen.getByText(/Not set yet: Protein target\./u)).not.toBeNull();
  });

  it('explains a value outside its range after the field is left and sends nothing when saving anyway', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply());
    renderSettings();
    await screen.findByLabelText('Resting energy burn (kcal)');
    const resting = await replace(user, 'Resting energy burn (kcal)', '12');
    expect(screen.queryByText(/enter a whole number from 1000 to 4000 kcal/u)).toBeNull();
    await user.tab();
    const message = 'Resting energy burn: enter a whole number from 1000 to 4000 kcal, or leave it empty.';
    expect((await screen.findByText(message)).getAttribute('role')).toBe('alert');
    expect(resting.getAttribute('aria-invalid')).toBe('true');
    expect(resting.getAttribute('aria-describedby')).toBe('nutrition-restingKcal-hint nutrition-restingKcal-error');

    await user.click(field('Daily deficit (kcal)'));
    await user.click(saveButton());
    expect(document.activeElement).toBe(resting);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['letters', 'abc'],
    ['a decimal', '1750.5'],
    ['a negative number', '-5'],
    ['an exponent', '1e3'],
  ])('refuses %s without sending it', async (_label, text) => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply());
    renderSettings();
    await screen.findByLabelText('Resting energy burn (kcal)');
    await replace(user, 'Resting energy burn (kcal)', text);
    await user.click(saveButton());
    expect(await screen.findByText(/^Resting energy burn: enter a whole number/u)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('locks the form while saving and sends a double submit only once', async () => {
    const user = userEvent.setup();
    const pending = deferred<Response>();
    fetchMock.mockResolvedValueOnce(reply()).mockReturnValueOnce(pending.promise);
    renderSettings();
    await screen.findByLabelText('Resting energy burn (kcal)');
    const resting = await replace(user, 'Resting energy burn (kcal)', '1800');
    const form = screen.getByRole('form', { name: 'Nutrition targets' });
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(saveButton().textContent).toBe('Saving…');
    expect(saveButton().disabled).toBe(true);
    expect(resting.readOnly).toBe(true);
    expect(form.getAttribute('aria-busy')).toBe('true');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { pending.resolve(reply({ ...filled, restingKcal: 1800 })); });
    expect(await screen.findByText('Nutrition targets saved.')).not.toBeNull();
    expect(resting.readOnly).toBe(false);
    expect(form.getAttribute('aria-busy')).toBe('false');
  });

  it.each([
    [400, 'Nutrition targets were not saved. Check that each value is a whole number in its range, then try again.'],
    [403, 'Nutrition targets are private to the Jarvis owner. Sign in as the owner to change them.'],
    [503, 'Nutrition targets could not be saved. Your entries are kept: save again, or reload Settings to see what is stored.'],
  ])('keeps the entry and uses its own words when saving answers %i', async (status, message) => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply()).mockResolvedValueOnce(failure(status));
    renderSettings();
    await screen.findByLabelText('Resting energy burn (kcal)');
    const resting = await replace(user, 'Resting energy burn (kcal)', '1800');
    await user.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(screen.queryByText(/Private server detail/u)).toBeNull();
    expect(resting.value).toBe('1800');
    expect(saveButton().disabled).toBe(false);
    expect(saveButton().textContent).toBe('Save nutrition targets');
  });

  it('does not claim success when the save reply cannot be read', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply()).mockResolvedValueOnce(new Response('not json', { status: 200 }));
    renderSettings();
    await screen.findByLabelText('Resting energy burn (kcal)');
    await replace(user, 'Resting energy burn (kcal)', '1800');
    await user.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Nutrition targets were sent, but the reply could not be read. Reload Settings to see what is stored.',
    );
    expect(screen.queryByText('Nutrition targets saved.')).toBeNull();
  });

  it('offers a retry when the first read fails and never shows the server text', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(failure(502)).mockResolvedValueOnce(reply());
    renderSettings();
    expect((await screen.findByRole('alert')).textContent).toBe('Nutrition targets could not be loaded. Try again.');
    expect(screen.queryByText(/Private server detail/u)).toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText('Resting energy burn (kcal)')).not.toBeNull();
    expect(field('Resting energy burn (kcal)').value).toBe('1750');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses a reply that is off contract instead of showing it', async () => {
    const odd = new Response(JSON.stringify({
      targets: { ...filled, restingKcal: 'lots' }, missing: [], updatedAt: savedAt, bounds,
    }), { status: 200 });
    fetchMock.mockResolvedValueOnce(odd);
    renderSettings();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Jarvis answered in a form this page cannot read. Nothing was changed. Try again.',
    );
    expect(screen.queryByLabelText('Resting energy burn (kcal)')).toBeNull();
  });

  it('says the page is unavailable when the route does not exist', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    renderSettings();
    expect(await screen.findByText('Nutrition targets are not available here.')).not.toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('makes no request without a backend', async () => {
    renderSettings(null);
    expect(await screen.findByText('Nutrition targets are not available here.')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a sign-in failure as a denied read without calling the backend', async () => {
    getAccessToken.mockRejectedValueOnce(new Error('session expired'));
    renderSettings();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Nutrition targets are private to the Jarvis owner. Sign in as the owner to read them.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops its request when the section goes away', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const view = renderSettings();
    await screen.findByText('Loading nutrition targets…');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
