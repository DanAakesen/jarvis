import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProactiveSettings } from './ProactiveSettings';

const backendUrl = 'https://api.example.com';
const settings = {
  paused: false,
  monthlyBudgetDkk: 100,
  sources: [
    { id: 'todos', enabled: true },
    { id: 'calendar', enabled: true },
    { id: 'mail', enabled: false },
    { id: 'weather', enabled: false },
    { id: 'factory', enabled: true },
    { id: 'news', enabled: true },
    { id: 'travel', enabled: false },
    { id: 'x', enabled: true },
  ],
  newsFeeds: ['https://news.example.invalid/feed.xml'],
  guidance: 'Prefer concise summaries.',
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function renderSettings() {
  return render(<ProactiveSettings backendUrl={backendUrl} getAccessToken={async () => 'fixture-token'} />);
}

function mountFetch(patchResponse?: Response) {
  fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PATCH') return patchResponse ?? response(settings);
    return response(settings);
  });
  vi.stubGlobal('fetch', fetchMock);
}

async function openSection(user = userEvent.setup()) {
  await user.click(await screen.findByRole('button', { name: 'Proactive' }));
  return user;
}

beforeEach(() => {
  mountFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Proactive settings', () => {
  it('loads privately, shows x disabled and persists no settings or section state', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderSettings();
    const user = await openSection();
    expect(screen.getByRole('switch', { name: /X/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Off. No provider connected.')).not.toBeNull();
    expect(screen.getByLabelText('Guidance')).toHaveProperty('value', settings.guidance);
    expect(setItem).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(`${backendUrl}/proactive/settings`, expect.objectContaining({
      cache: 'no-store',
      headers: expect.any(Headers),
    }));
    await user.click(screen.getByRole('button', { name: 'Proactive' }));
    expect(setItem).not.toHaveBeenCalled();
  });

  it('saves only changed fields and never renders a server response body on 400', async () => {
    renderSettings();
    const user = await openSection();
    fireEvent.change(screen.getByLabelText('Guidance'), { target: { value: 'Keep the next step clear.' } });
    await user.click(screen.getByRole('button', { name: 'Save proactive settings' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
    const request = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({ guidance: 'Keep the next step clear.' });

    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'PATCH' ? response({ error: 'DO NOT SHOW THIS' }, 400) : response(settings));
    fireEvent.change(screen.getByLabelText('Guidance'), { target: { value: 'Another private preference.' } });
    await user.click(screen.getByRole('button', { name: 'Save proactive settings' }));
    expect(await screen.findByText('Check this value and try again.')).not.toBeNull();
    expect(screen.queryByText('DO NOT SHOW THIS')).toBeNull();
  });

  it('saves pause immediately with only the paused field', async () => {
    renderSettings();
    const user = await openSection();
    await user.click(screen.getByRole('switch', { name: 'Pause proactive checks' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ paused: true });
  });

  it('requires a whole-number budget from zero through one thousand', async () => {
    renderSettings();
    const user = await openSection();
    const field = screen.getByLabelText('Monthly budget (DKK)');
    for (const value of ['', '12.5', '-1', '1001']) {
      fireEvent.change(field, { target: { value } });
      expect(screen.getByText('Enter a whole number from 0 to 1,000.')).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Save proactive settings' }).hasAttribute('disabled')).toBe(true);
    }
    fireEvent.change(field, { target: { value: '250' } });
    await user.click(screen.getByRole('button', { name: 'Save proactive settings' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1];
    expect(JSON.parse(String(patch?.body))).toEqual({ monthlyBudgetDkk: 250 });
  });

  it('validates feed protocol, duplicates and count before saving', async () => {
    renderSettings();
    const user = await openSection();
    await user.click(screen.getByRole('button', { name: 'Add feed' }));
    expect(await screen.findByText('Enter an HTTPS URL.')).not.toBeNull();
    const field = screen.getByLabelText('Feed 2');
    fireEvent.change(field, { target: { value: 'http://news.example.invalid/rss' } });
    expect(await screen.findByText('Enter a valid HTTPS URL.')).not.toBeNull();
    fireEvent.change(field, { target: { value: 'https://news.example.invalid/feed.xml' } });
    expect(await screen.findByText('Each feed URL must be unique.')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save proactive settings' }).hasAttribute('disabled')).toBe(true);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('enforces feed length and a maximum of ten entries', async () => {
    renderSettings();
    const user = await openSection();
    await user.click(screen.getByRole('button', { name: 'Add feed' }));
    fireEvent.change(screen.getByLabelText('Feed 2'), { target: { value: `https://${'a'.repeat(293)}` } });
    expect(await screen.findByText('Use a URL of at most 300 characters.')).not.toBeNull();
    for (let index = 2; index < 10; index += 1) {
      await user.click(screen.getByRole('button', { name: 'Add feed' }));
    }
    expect(screen.getAllByLabelText(/^Feed \d+$/u)).toHaveLength(10);
    expect(screen.queryByRole('button', { name: 'Add feed' })).toBeNull();
  });

  it('enforces the 1,000-character guidance limit', async () => {
    renderSettings();
    await openSection();
    fireEvent.change(screen.getByLabelText('Guidance'), { target: { value: 'x'.repeat(1001) } });
    expect(await screen.findByText('Use at most 1,000 characters.')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save proactive settings' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows a non-retryable backend-off state for settings 404', async () => {
    fetchMock.mockResolvedValue(response({}, 404));
    renderSettings();
    await openSection();
    expect(await screen.findByText('Proactive is not turned on for this backend.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});
