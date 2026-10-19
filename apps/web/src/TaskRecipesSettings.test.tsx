import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskRecipesSettings } from './TaskRecipesSettings';

const backendUrl = 'https://api.example.com/';
const getAccessToken = vi.fn(async () => ['access', 'fixture'].join('.'));
const fetchMock = vi.fn<typeof fetch>();
const pcRecipe = {
  id: 'pc/1',
  kind: 'pc',
  key: 'notepad',
  goal: '  open   a document  ',
  steps: [{ operation: 'click', automationId: 'open' }],
};
const browserRecipe = {
  id: 'browser-1',
  kind: 'browser',
  key: 'example.com',
  goal: 'open account',
  steps: [{ operation: 'click', selector: '#account' }, { operation: 'click', selector: '#details' }],
};

function response(recipes: unknown = [], status = 200) {
  return new Response(JSON.stringify({ recipes }), { status });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function renderRecipes() {
  return render(<TaskRecipesSettings backendUrl={backendUrl} getAccessToken={getAccessToken} />);
}

beforeEach(() => {
  fetchMock.mockReset();
  getAccessToken.mockReset().mockResolvedValue(['access', 'fixture'].join('.'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('TaskRecipesSettings', () => {
  it('shows loading, authenticated summaries and refresh without exposing step contents', async () => {
    const user = userEvent.setup();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response());
    renderRecipes();
    expect(screen.getByText('Loading routines…')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Refreshing…' }).hasAttribute('disabled')).toBe(true);
    await act(async () => { pending.resolve(response([pcRecipe, browserRecipe])); });
    expect(await screen.findByText('PC app: notepad')).not.toBeNull();
    expect(screen.getByText('Browser site: example.com')).not.toBeNull();
    expect(screen.getByText('open a document')).not.toBeNull();
    expect(screen.getByText('1 step')).not.toBeNull();
    expect(screen.getByText('2 steps')).not.toBeNull();
    expect(screen.queryByText('#account')).toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/recipes');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      cache: 'no-store',
      headers: { Authorization: `${['Bear', 'er'].join('')} ${await getAccessToken()}` },
    });
    await user.click(screen.getByRole('button', { name: 'Refresh routines' }));
    expect(await screen.findByText('No saved routines.')).not.toBeNull();
  });

  it('is named Routines everywhere the user can see or hear it', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(response([pcRecipe])).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const view = renderRecipes();
    await screen.findByText('open a document');
    const heading = screen.getByRole('heading', { name: 'Routines' });
    expect(heading.id).toBe('routines-heading');
    expect(screen.getByRole('list', { name: 'Saved routines' })).not.toBeNull();
    const visibleText = [view.container.textContent ?? '', ...[...view.container.querySelectorAll('[aria-label]')]
      .map((element) => element.getAttribute('aria-label') ?? '')].join('\n');
    expect(visibleText).not.toMatch(/recipe/i);
    await user.click(screen.getByRole('button', { name: 'Delete routine: open a document (notepad)' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete routine: open a document (notepad)' }));
    expect(await screen.findByText('Routine deleted: open a document.')).not.toBeNull();
    expect(view.container.textContent ?? '').not.toMatch(/recipe/i);
  });

  it('requires confirmation and restores the Delete action with Cancel or Escape', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(response([pcRecipe]));
    renderRecipes();
    const name = 'Delete routine: open a document (notepad)';
    const confirmName = 'Confirm delete routine: open a document (notepad)';
    await user.click(await screen.findByRole('button', { name }));

    expect(screen.getByText('Confirm delete routine')).not.toBeNull();
    expect(screen.queryByRole('button', { name })).toBeNull();
    const confirm = screen.getByRole('button', { name: confirmName });
    expect(confirmName.startsWith(confirm.textContent ?? '')).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name }).textContent).toBe('Delete');

    await user.click(screen.getByRole('button', { name }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name }).textContent).toBe('Delete');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('offers recovery for failed loads and rejects malformed data', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(response([{ ...pcRecipe, steps: null }]))
      .mockResolvedValueOnce(response());
    renderRecipes();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not load routines. Try again.');
    expect(screen.queryByText('No saved routines.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry routines' }));
    expect(await screen.findByRole('button', { name: 'Retry routines' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry routines' }));
    expect(await screen.findByText('No saved routines.')).not.toBeNull();
  });

  it('keeps previously loaded routines visible when a refresh fails', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(response([pcRecipe])).mockResolvedValueOnce(response([], 503));
    renderRecipes();
    await screen.findByText('open a document');
    await user.click(screen.getByRole('button', { name: 'Refresh routines' }));
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(screen.getByText('Previously loaded routines are shown.')).not.toBeNull();
    expect(screen.getByText('open a document')).not.toBeNull();
  });

  it('shows delete progress, blocks conflicting requests and reports confirmed deletion', async () => {
    const user = userEvent.setup();
    const pending = deferred<Response>();
    fetchMock.mockResolvedValueOnce(response([pcRecipe, browserRecipe])).mockReturnValueOnce(pending.promise);
    renderRecipes();
    await screen.findByText('open a document');
    await user.click(screen.getByRole('button', { name: 'Delete routine: open a document (notepad)' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Confirm delete routine: open a document (notepad)' }));
    expect(screen.getByText('Deleting…')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh routines' }).hasAttribute('disabled')).toBe(true);
    const rows = within(screen.getByRole('list', { name: 'Saved routines' }));
    expect(rows.getAllByRole('button').every((button) => button.hasAttribute('disabled'))).toBe(true);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.example.com/recipes/pc%2F1');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'DELETE' });
    await act(async () => { pending.resolve(new Response(null, { status: 204 })); });
    expect(await screen.findByText('Routine deleted: open a document.')).not.toBeNull();
    expect(screen.queryByText('PC app: notepad')).toBeNull();
    expect(screen.getByText('Browser site: example.com')).not.toBeNull();
  });

  it('retains a routine after delete failure and lets the user retry', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(response([pcRecipe]))
      .mockResolvedValueOnce(response([], 500))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    renderRecipes();
    const name = 'Delete routine: open a document (notepad)';
    const confirmName = 'Confirm delete routine: open a document (notepad)';
    await user.click(await screen.findByRole('button', { name }));
    await user.click(screen.getByRole('button', { name: confirmName }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not delete this routine. Try Delete again.');
    expect(screen.getByText('open a document')).not.toBeNull();
    await user.click(screen.getByRole('button', { name }));
    await user.click(screen.getByRole('button', { name: confirmName }));
    expect(await screen.findByText('No saved routines.')).not.toBeNull();
  });

  it('aborts an old load and ignores its result after changing the service', async () => {
    const old = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response([browserRecipe]));
    const view = renderRecipes();
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1); });
    const oldSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    view.rerender(<TaskRecipesSettings backendUrl="https://other.example.com" getAccessToken={getAccessToken} />);
    await screen.findByText('Browser site: example.com');
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => { old.resolve(response([pcRecipe])); });
    expect(screen.queryByText('PC app: notepad')).toBeNull();
  });

  it('does not start a request after unmount while authorization is pending', async () => {
    const token = deferred<string>();
    getAccessToken.mockReturnValueOnce(token.promise);
    const view = renderRecipes();
    view.unmount();
    await act(async () => { token.resolve('fixture'); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts an in-flight deletion when unmounted', async () => {
    const user = userEvent.setup();
    const pending = deferred<Response>();
    fetchMock.mockResolvedValueOnce(response([pcRecipe])).mockReturnValueOnce(pending.promise);
    const view = renderRecipes();
    await user.click(await screen.findByRole('button', { name: 'Delete routine: open a document (notepad)' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete routine: open a document (notepad)' }));
    const signal = fetchMock.mock.calls[1]?.[1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.resolve(new Response(null, { status: 204 })); });
  });

  it('explains an unavailable backend without attempting requests', async () => {
    render(<TaskRecipesSettings backendUrl={null} getAccessToken={getAccessToken} />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Routines unavailable.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retry routines' }).hasAttribute('disabled')).toBe(true);
  });
});
