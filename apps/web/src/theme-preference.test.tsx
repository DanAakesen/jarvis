import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemePreferenceProvider } from './theme-preference';
import { useThemePreference } from './theme-preference-context';

const backendUrl = 'https://api.example.com';
const getAccessToken = vi.fn(async () => 'fixture-token');
const fetchMock = vi.fn<typeof fetch>();

function response(theme: string, status = 200, appearance: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ settings: { appearance: { theme, ...appearance } } }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

function ThemeControls() {
  const preference = useThemePreference();
  return (
    <>
      <fieldset disabled={preference.state !== 'ready' || preference.saving}>
        <legend>Theme</legend>
        {(['light', 'dark', 'system'] as const).map((theme) => (
          <label key={theme}>
            <input type="radio" name="theme" value={theme} checked={preference.theme === theme}
              onChange={() => { void preference.saveTheme(theme); }} />
            {theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'System'}
          </label>
        ))}
      </fieldset>
      <button type="button" onClick={() => { void preference.refreshAppearance(); }}>Refresh appearance</button>
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
  document.documentElement.removeAttribute('data-background');
  document.documentElement.removeAttribute('data-motion');
  document.documentElement.style.cssText = '';
  vi.stubGlobal('fetch', fetchMock);
});

it('tracks OS appearance while preserving the saved system preference', async () => {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    matches: true,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => media);
  fetchMock.mockResolvedValueOnce(response('system'));
  renderPreference();

  expect(await screen.findByRole('radio', { name: 'System' })).toHaveProperty('checked', true);
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));

  act(() => {
    media.matches = false;
    listeners.forEach((listener) => listener({ matches: false } as MediaQueryListEvent));
  });
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
  expect(screen.getByRole('radio', { name: 'System' })).toHaveProperty('checked', true);
});

it('applies approved appearance tokens when refreshed after Jarvis updates them', async () => {
  fetchMock.mockResolvedValueOnce(response('light'))
    .mockResolvedValueOnce(response('dark', 200, {
      accent: '#2468ac',
      'accent-secondary': '#d08c43',
      'surface-tint': '#b6c8d1',
      background: 'daylight-studio',
      glow: 0.6,
      motion: 'calm',
      radius: 14,
      density: 'compact',
    }));
  renderPreference();

  await screen.findByRole('radio', { name: 'Light' });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh appearance' }));

  await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  expect(document.documentElement.dataset.background).toBe('daylight-studio');
  expect(document.documentElement.dataset.motion).toBe('calm');
  expect(document.documentElement.style.getPropertyValue('--theme-accent')).toBe('#2468ac');
  expect(document.documentElement.style.getPropertyValue('--theme-accent-foreground')).toBe('#ffffff');
  expect(document.documentElement.style.getPropertyValue('--theme-accent-secondary')).toBe('#d08c43');
  expect(document.documentElement.style.getPropertyValue('--theme-surface-tint')).toBe('#b6c8d1');
  expect(document.documentElement.style.getPropertyValue('--theme-glow')).toBe('0.6');
  expect(document.documentElement.style.getPropertyValue('--theme-radius')).toBe('14px');
  expect(document.documentElement.style.getPropertyValue('--theme-density-scale')).toBe('0.8');
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

  it('keeps prior appearance settings when a returned token is invalid', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(response('light'))
      .mockResolvedValueOnce(response('dark', 200, { accent: 'not-a-color' }));
    renderPreference();

    await screen.findByRole('radio', { name: 'Light' });
    await user.click(screen.getByRole('radio', { name: 'Dark' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Jarvis returned invalid theme settings. Try again.');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--theme-accent')).toBe('');
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveProperty('checked', true);
  });
});
