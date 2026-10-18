import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { systemSmokeCheckIds, type SystemStatus } from '@jarvis/contracts';
import { StatusPage } from './StatusPage';

const fetchMock = vi.fn<typeof fetch>();
const getAccessToken = vi.fn(async () => 'fixture-token');
const ids = ['database', 'foundry.chat', 'foundry.voice', 'foundry.embeddings', 'vault_index', 'github_app',
  'google', 'pc_bridge', 'runner', 'deployed_commit', 'last_error'] as const;

function snapshot(checkedAt = new Date().toISOString()): SystemStatus {
  return {
    checkedAt,
    entries: ids.map(id => ({
      id, checkedAt, status: id === 'github_app' ? 'down' : id === 'runner' ? 'unknown' : 'ok',
      ...(id === 'github_app' ? { details: { reason: 'check_failed' } } :
        id === 'pc_bridge' ? { details: { connected: true, controlPaused: false, bridgeVersion: null } } : {}),
    })),
    smoke: { checkedAt, entries: systemSmokeCheckIds.map(id => ({ id, status: 'ok', checkedAt })) },
  };
}

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccessToken.mockResolvedValue('fixture-token');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async () => response(snapshot()));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Status page', () => {
  it('shows all recorded checks, real failures, bridge metadata and the retained smoke report without rerunning it', async () => {
    render(<StatusPage backendUrl="https://api.example.com/" getAccessToken={getAccessToken} />);
    const github = await screen.findByRole('listitem', { name: 'GitHub App' });
    expect(within(github).getByText('Failing')).not.toBeNull();
    expect(within(github).getByText('Check failed')).not.toBeNull();
    expect(within(screen.getByRole('listitem', { name: 'Agent runner' })).getByText('Runtime health is not established by this check.')).not.toBeNull();
    const bridge = screen.getByRole('listitem', { name: 'PC bridge' });
    expect(within(bridge).getByText('Connected at check time. PC control is not paused.')).not.toBeNull();
    fireEvent.click(within(bridge).getByText('Recorded details'));
    expect(within(bridge).getByText('Connected')).not.toBeNull();
    expect(within(bridge).getByText('Yes')).not.toBeNull();
    expect(within(bridge).getByText('Not reported')).not.toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(11 + systemSmokeCheckIds.length);
    expect(screen.getByRole('heading', { name: 'Recorded smoke check' })).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/status', expect.objectContaining({
      headers: { Authorization: `${['Bear', 'er'].join('')} fixture-token`, Accept: 'application/json' },
      cache: 'no-store', signal: expect.any(AbortSignal),
    }));
  });

  it.each([
    { connected: false, text: 'Disconnected at check time.' },
    { connected: null, text: 'Connection state was not reported.' },
  ])('shows reported bridge connection $connected without requiring details expansion', async ({ connected, text }) => {
    const report = snapshot();
    report.entries = report.entries.map(entry => entry.id === 'pc_bridge'
      ? { ...entry, status: connected === false ? 'down' : 'unknown', details: { connected, controlPaused: true } }
      : entry);
    fetchMock.mockResolvedValue(response(report));
    render(<StatusPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    const bridge = await screen.findByRole('listitem', { name: 'PC bridge' });
    expect(within(bridge).getByText(`${text} PC control is paused.`)).not.toBeNull();
  });

  it('explains missing smoke evidence rather than inventing a deployment result', async () => {
    const report = snapshot();
    delete report.smoke;
    fetchMock.mockResolvedValue(response(report));
    render(<StatusPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    expect(await screen.findByText(/Unavailable: the backend has no recorded smoke report/)).not.toBeNull();
  });

  it.each([
    { status: 401, message: /Microsoft sign-in needs attention/ },
    { status: 503, message: /System status could not be loaded/ },
  ])('exposes HTTP $status and allows an ordinary status retry', async ({ status, message }) => {
    fetchMock.mockResolvedValueOnce(response({}, status));
    render(<StatusPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(message);
    fireEvent.click(screen.getByRole('button', { name: 'Retry status' }));
    await screen.findByRole('listitem', { name: 'SQL database' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['missing', 'duplicate', 'invalid status', 'invalid detail', 'invalid smoke'])('rejects %s payload data', async problem => {
    const report = snapshot();
    const invalid: unknown = problem === 'missing' ? { ...report, entries: report.entries.slice(1) } :
      problem === 'duplicate' ? { ...report, entries: report.entries.map(() => report.entries[0]) } :
        problem === 'invalid status' ? { ...report, entries: report.entries.map(entry => ({ ...entry, status: 'healthy' })) } :
          problem === 'invalid detail' ? { ...report, entries: report.entries.map(entry => ({ ...entry, details: { value: {} } })) } :
            { ...report, smoke: { checkedAt: report.checkedAt, entries: [] } };
    fetchMock.mockResolvedValue(response(invalid));
    render(<StatusPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/invalid system status response/);
    expect(screen.queryByRole('listitem', { name: 'SQL database' })).toBeNull();
  });

  it('keeps the previous data explicitly marked when a refresh fails', async () => {
    render(<StatusPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    await screen.findByRole('listitem', { name: 'Google' });
    fetchMock.mockResolvedValueOnce(response({}, 502));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    expect((await screen.findByRole('status')).textContent).toContain('last status snapshot remains visible');
    expect(screen.queryByText(/HTTP \d+/)).toBeNull();
    expect(screen.getByRole('listitem', { name: 'Google' })).not.toBeNull();
    expect(screen.getByText(/Previous snapshot/)).not.toBeNull();
  });

  it('ages the snapshot, individual checks and smoke report without background probe requests', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(response(snapshot(new Date(Date.now() - 299_000).toISOString())));
    const view = render(<StatusPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('listitem', { name: 'SQL database' })).not.toBeNull();
    expect(screen.queryByText('Stale')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(view.container.querySelectorAll('.system-status-stale').length).toBe(13 + systemSmokeCheckIds.length);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bounds an unresponsive request and offers recovery', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    render(<StatusPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole('alert').textContent).toContain('timed out');
    expect(screen.getByRole('button', { name: 'Retry status' })).not.toBeNull();
  });

  it('cancels an old backend request and never shows its late result for a replacement backend', async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<StatusPage backendUrl="https://old.example.com" getAccessToken={getAccessToken} />);
    await act(async () => { await Promise.resolve(); });
    const oldSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    view.rerender(<StatusPage backendUrl="https://new.example.com" getAccessToken={getAccessToken} />);
    await screen.findByRole('listitem', { name: 'SQL database' });
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => { finish(response({}, 503)); });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not request status without a backend or after sign-in fails', async () => {
    const view = render(<StatusPage backendUrl={null} getAccessToken={getAccessToken} />);
    expect((await screen.findByRole('alert')).textContent).toContain('backend is not configured');
    expect(fetchMock).not.toHaveBeenCalled();
    getAccessToken.mockRejectedValueOnce(new Error('Private provider failure'));
    view.rerender(<StatusPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Microsoft sign-in needs attention');
    expect(screen.queryByText('Private provider failure')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
