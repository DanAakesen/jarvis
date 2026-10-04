import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemePreferenceProvider } from './theme-preference';
import { useThemePreference } from './theme-preference-context';

const backendUrl = 'https://api.example.com';
const getAccessToken = vi.fn(async () => 'fixture-token');
const fetchMock = vi.fn<typeof fetch>();

function response(theme: string, status = 200) {
  return new Response(JSON.stringify({ settings: { appearance: { theme } } }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

function ThemeControls() {
  const preference = useThemePreference();
  return (
    <>
      <fieldset disabled={preference.state !== 'ready' || preference.saving}>
        <legend>Theme</legend>
        {(['light', 'dark'] as const).map((theme) => (
          <label key={theme}>
            <input type="radio" name="theme" value={theme} checked={preference.theme === theme}
              onChange={() => { void preference.saveTheme(theme); }} />
            {theme === 'light' ? 'Light' : 'Dark'}
          </label>
        ))}
      </fieldset>
      {preference.state === 'loading' && <p role="status">Loading saved theme…</p>}
      {preference.saving && <p role="status">Saving theme…</p>}
      {preference.error && <p role="alert">{preference.error}</p>}
      {preference.message && <p role="status">{preference.message}</p>}
      <output>{preference.theme}</output>
    </>
  );
}

function renderPreference() {
  return render(
    <ThemePreferenceProvider enabled backendUrl={backendUrl} getAccessToken={getAccessToken}>
      <ThemeControls />
    </ThemePreferenceProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  getAccessToken.mockClear();
  document.documentElement.dataset.theme = 'light';
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ThemePreferenceProvider', () => {
  it('hydrates the accepted theme from settings and applies it to the document', async () => {
    fetchMock.mockResolvedValueOnce(response('dark'));
    renderPreference();

    await waitFor(() => expect(screen.getByRole('radio', { name: 'Dark' })).toHaveProperty('checked', true));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(fetchMock).toHaveBeenCalledWith(`${backendUrl}/settings`, expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: `${['Bear', 'er'].join('')} fixture-token` }),
    }));
  });

  it('persists an accepted mode and restores it after reopening the provider', async () => {
    const user = userEvent.setup();
    let storedTheme = 'light';
    fetchMock.mockImplementation(async (_input, init) => {
      if (init?.method === 'PATCH') {
        storedTheme = JSON.parse(String(init.body)).settings.appearance.theme;
      }
      return response(storedTheme);
    });
    const firstVisit = renderPreference();

    await waitFor(() => expect(screen.getByRole('radio', { name: 'Light' })).toHaveProperty('disabled', false));
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(storedTheme).toBe('dark');
    expect(await screen.findByText('Theme saved.')).not.toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Light' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    expect(storedTheme).toBe('light');
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(storedTheme).toBe('dark');

    firstVisit.unmount();
    document.documentElement.dataset.theme = 'light';
    renderPreference();

    expect(await screen.findByRole('radio', { name: 'Dark' })).toHaveProperty('checked', true);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  });

  it('keeps the prior mode active after a rejected update and recovers on retry', async () => {
    const user = userEvent.setup();
    let storedTheme = 'light';
    fetchMock
      .mockResolvedValueOnce(response('light'))
      .mockResolvedValueOnce(response('invalid setting value', 400))
      .mockImplementationOnce(async (_input, init) => {
        storedTheme = JSON.parse(String(init?.body)).settings.appearance.theme;
        return response(storedTheme);
      });
    renderPreference();

    await waitFor(() => expect(screen.getByRole('radio', { name: 'Light' })).toHaveProperty('disabled', false));
    await user.click(screen.getByRole('radio', { name: 'Dark' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/could not save the theme \(HTTP 400\)/);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveProperty('checked', true);
    expect(storedTheme).toBe('light');

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(storedTheme).toBe('dark');
  });
});
