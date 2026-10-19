import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { takeSignInReturnPath } from './auth';
import { ProactiveItemPage } from './ProactiveItemPage';

const backendUrl = 'https://api.example.com';
const itemId = '11111111-1111-4111-8111-111111111111';
const token = vi.fn(async () => 'fixture-token');
const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function itemResponse() {
  return {
    id: itemId,
    kind: 'test',
    title: 'Synthetic notification item',
    body: 'This is synthetic item content.',
    createdAt: '2026-10-17T12:00:00.000Z',
  };
}

function renderPage(path = `/proactive/${itemId}`, getAccessToken = token, signIn = vi.fn(async () => {})) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/proactive/:id" element={
          <ProactiveItemPage backendUrl={backendUrl} getAccessToken={getAccessToken} signIn={signIn} />
        } />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  token.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

describe('proactive item page', () => {
  it('loads the item through the authenticated client and renders its title, body and time', async () => {
    fetchMock.mockResolvedValue(jsonResponse(itemResponse()));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Synthetic notification item' })).not.toBeNull();
    expect(screen.getByText('This is synthetic item content.')).not.toBeNull();
    expect(screen.getByText('17 Oct 2026, 12:00').closest('time')?.getAttribute('dateTime'))
      .toBe(itemResponse().createdAt);
    expect(fetchMock).toHaveBeenCalledWith(`${backendUrl}/proactive/items/${itemId}`, expect.objectContaining({
      headers: { Authorization: `${['Bear', 'er'].join('')} fixture-token`, Accept: 'application/json' },
      cache: 'no-store',
    }));
  });

  it('does not distinguish another owner from an item that does not exist', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'not_found' }, 404));
    renderPage();
    expect(await screen.findByText('Item not found.')).not.toBeNull();
  });

  it('renders an error with a working retry', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 503)).mockResolvedValueOnce(jsonResponse(itemResponse()));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toContain('Item could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Synthetic notification item' })).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('offers sign-in after an expired session and preserves the same path for return', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 401));
    const signIn = vi.fn(async () => {});
    const path = `/proactive/${itemId}?from=notification`;
    renderPage(path, token, signIn);

    expect(await screen.findByText('Your sign-in has expired. Sign in again to open this item.')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(signIn).toHaveBeenCalledOnce();
    expect(takeSignInReturnPath()).toBe(path);
  });

  it('classifies a failed silent token renewal as a sign-in requirement', async () => {
    const expiredToken = vi.fn(async () => { throw new Error('Your Microsoft sign-in needs attention. Sign in again.'); });
    renderPage(`/proactive/${itemId}`, expiredToken);
    expect(await screen.findByRole('button', { name: 'Sign in again' })).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not make a request for a malformed item id', async () => {
    renderPage('/proactive/not-a-uuid');
    expect(await screen.findByText('Item not found.')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
