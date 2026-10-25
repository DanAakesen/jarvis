import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    vaultMirror: { state: 'not-set-up', lastSuccessAt: null },
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
  it('preserves the expanded loading row and keyboard focus when the first snapshot arrives', async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const user = userEvent.setup();
    render(<StatusPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    const toggle = screen.getByRole('button', { name: 'Vault mirror details' });
    await user.tab();
    expect(document.activeElement).toBe(toggle);
    await user.keyboard('{Enter}');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Waiting for mirror status.')).not.toBeNull();
    await act(async () => { finish(response(snapshot())); });
    expect(screen.getByRole('button', { name: 'Vault mirror details' })).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(toggle);
    expect(screen.getByText('Not set up')).not.toBeNull();
    expect(screen.getByText('No mirror status document yet.')).not.toBeNull();
  });

  it('shows not set up for a successful older backend snapshot without a mirror field', async () => {
    const report = snapshot();
    delete report.vaultMirror;
    fetchMock.mockResolvedValue(response(report));
    render(<StatusPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    await screen.findByRole('listitem', { name: 'SQL database' });
    expect(within(screen.getByRole('group', { name: 'Vault mirror' })).getByText('Not set up')).not.toBeNull();
    expect(screen.queryByText('Read error')).toBeNull();
  });

  it('keeps read error and accurate recovery copy on a failed fetch', async () => {
    fetchMock.mockResolvedValueOnce(response({}, 503));
    render(<StatusPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    await screen.findByRole('button', { name: 'Retry status' });
    const row = screen.getByRole('group', { name: 'Vault mirror' });
    expect(within(row).getByText('Read error')).not.toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Vault mirror details' }));
    expect(within(row).getByText('Mirror status could not be read. Try loading status again.')).not.toBeNull();
  });

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

  it('explains Foundry catalogue evidence and runner health without upgrading unknown checks', async () => {
    const report = snapshot();
    report.entries = report.entries.map(entry => entry.id === 'foundry.chat'
      ? { ...entry, status: 'unknown', details: { configured: true, catalogue: 'live', deploymentAvailable: true } }
      : entry.id === 'foundry.voice'
        ? { ...entry, status: 'degraded', details: { configured: true, catalogue: 'live', deploymentAvailable: false } }
        : entry.id === 'foundry.embeddings'
          ? { ...entry, status: 'degraded', details: { configured: true, catalogue: 'fallback', deploymentAvailable: true } }
          : entry.id === 'runner'
            ? { ...entry, status: 'unknown', details: { configured: true, healthProbe: 'not_run' } }
            : entry);
    fetchMock.mockResolvedValue(response(report));
    render(<StatusPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);

    const chat = await screen.findByRole('listitem', { name: 'Foundry chat' });
    expect(within(chat).getByText('Unknown')).not.toBeNull();
    expect(within(chat).getByText(/deployment is listed, but this check did not run a model request/)).not.toBeNull();
    const voice = screen.getByRole('listitem', { name: 'Foundry voice' });
    expect(within(voice).getByText('Degraded')).not.toBeNull();
    expect(within(voice).getByText(/No deployment for this capability was found in the live model catalogue/)).not.toBeNull();
    const embeddings = screen.getByRole('listitem', { name: 'Foundry embeddings' });
    expect(within(embeddings).getByText('Degraded')).not.toBeNull();
    expect(within(embeddings).getByText(/fallback configuration; live deployment availability is not verified/)).not.toBeNull();
    const runner = screen.getByRole('listitem', { name: 'Agent runner' });
    expect(within(runner).getByText('Unknown')).not.toBeNull();
    expect(within(runner).getByText(/runtime health has not been probed/)).not.toBeNull();
  });

  it.each([
    {
      outcome: 'pending',
      latestSyncAttemptAt: null,
      syncFresh: null,
      embeddingCoveragePercent: 100,
      message: 'No completed vault sync is verified since this backend process started.',
    },
    {
      outcome: 'error',
      latestSyncAttemptAt: '2026-10-25T11:30:00.000Z',
      syncFresh: true,
      embeddingCoveragePercent: 100,
      message: 'The latest vault sync attempt failed.',
    },
    {
      outcome: 'ok',
      latestSyncAttemptAt: '2026-10-24T11:30:00.000Z',
      syncFresh: false,
      embeddingCoveragePercent: 100,
      message: 'The last successful sync is over 24 hours old or has a future-dated timestamp.',
    },
    {
      outcome: 'ok',
      latestSyncAttemptAt: '2026-10-25T11:30:00.000Z',
      syncFresh: true,
      embeddingCoveragePercent: 50,
      message: 'Embedding coverage is incomplete (1 of 2 chunks embedded).',
    },
  ])('explains vault index $outcome evidence', async ({ outcome, latestSyncAttemptAt, syncFresh, embeddingCoveragePercent, message }) => {
    const report = snapshot();
    report.entries = report.entries.map(entry => entry.id === 'vault_index'
      ? {
        ...entry,
        status: outcome === 'pending' ? 'unknown' : 'degraded',
        details: {
          chunks: 2,
          embeddedChunks: embeddingCoveragePercent === 100 ? 2 : 1,
          embeddingCoveragePercent,
          latestIndexedAt: '2026-10-25T11:00:00.000Z',
          latestSyncAttemptAt,
          lastSuccessfulSyncAt: outcome === 'pending' ? null : '2026-10-25T11:30:00.000Z',
          syncOutcome: outcome,
          syncFresh,
        },
      }
      : entry);
    fetchMock.mockResolvedValue(response(report));
    render(<StatusPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);

    const vault = await screen.findByRole('listitem', { name: 'Vault index' });
    expect(within(vault).getByText(message)).not.toBeNull();
  });

  it('does not hide stale prior success during a pending sync', async () => {
    const report = snapshot();
    report.entries = report.entries.map(entry => entry.id === 'vault_index'
      ? {
        ...entry,
        status: 'degraded',
        details: {
          chunks: 2,
          embeddedChunks: 2,
          embeddingCoveragePercent: 100,
          latestIndexedAt: '2026-10-25T11:00:00.000Z',
          latestSyncAttemptAt: '2026-10-25T11:59:00.000Z',
          lastSuccessfulSyncAt: '2026-10-24T11:00:00.000Z',
          syncOutcome: 'pending',
          syncFresh: false,
        },
      }
      : entry);
    fetchMock.mockResolvedValue(response(report));
    render(<StatusPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);

    const vault = await screen.findByRole('listitem', { name: 'Vault index' });
    expect(within(vault).getByText('Degraded')).not.toBeNull();
    expect(within(vault).getByText(/A vault sync attempt is still running/)).not.toBeNull();
    expect(within(vault).getByText(/last successful sync is over 24 hours old/)).not.toBeNull();
  });

  it('labels a healthy index as based on the last success while a newer sync is pending', async () => {
    const report = snapshot();
    report.entries = report.entries.map(entry => entry.id === 'vault_index'
      ? {
        ...entry,
        status: 'ok',
        details: {
          chunks: 2,
          embeddedChunks: 2,
          embeddingCoveragePercent: 100,
          latestIndexedAt: '2026-10-01T11:00:00.000Z',
          latestSyncAttemptAt: '2026-10-25T11:59:00.000Z',
          lastSuccessfulSyncAt: '2026-10-25T11:30:00.000Z',
          syncOutcome: 'pending',
          syncFresh: true,
        },
      }
      : entry);
    fetchMock.mockResolvedValue(response(report));
    render(<StatusPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);

    const vault = await screen.findByRole('listitem', { name: 'Vault index' });
    expect(within(vault).getByText('OK')).not.toBeNull();
    expect(within(vault).getByText(/status reflects the last successful sync/)).not.toBeNull();
  });

  it('keeps vault evidence timestamps distinct from a refreshed status-check time', async () => {
    const checkedAt = '2026-10-25T11:59:00.000Z';
    const refreshedAt = '2026-10-25T12:00:00.000Z';
    const lastSync = '2026-10-24T12:00:00.000Z';
    const latestContent = '2026-10-01T12:00:00.000Z';
    const report = (at: string): SystemStatus => {
      const value = snapshot(at);
      value.entries = value.entries.map(entry => entry.id === 'vault_index'
        ? {
          ...entry,
          details: {
            chunks: 2,
            embeddingCoveragePercent: 100,
            latestIndexedAt: latestContent,
            latestSyncAttemptAt: lastSync,
            lastSuccessfulSyncAt: lastSync,
            syncOutcome: 'ok',
            syncFresh: true,
          },
        }
        : entry);
      return value;
    };
    fetchMock.mockResolvedValueOnce(response(report(checkedAt))).mockResolvedValueOnce(response(report(refreshedAt)));
    render(<StatusPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    const vault = await screen.findByRole('listitem', { name: 'Vault index' });

    expect(vault.querySelector(`time[datetime="${checkedAt}"]`)).not.toBeNull();
    expect(vault.querySelector(`time[datetime="${lastSync}"]`)).not.toBeNull();
    expect(vault.querySelector(`time[datetime="${latestContent}"]`)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    await waitFor(() => expect(vault.querySelector(`time[datetime="${refreshedAt}"]`)).not.toBeNull());
    expect(vault.querySelector(`time[datetime="${refreshedAt}"]`)).not.toBeNull();
    expect(vault.querySelector(`time[datetime="${lastSync}"]`)).not.toBeNull();
    expect(vault.querySelector(`time[datetime="${latestContent}"]`)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the page intro the only top-level snapshot so the smoke timestamp is not styled as a panel', async () => {
    const view = render(<StatusPage backendUrl="https://api.example.com/" getAccessToken={getAccessToken} />);
    await screen.findByRole('listitem', { name: 'GitHub App' });
    expect(view.container.querySelectorAll('.system-status-snapshot')).toHaveLength(2);
    const [intro] = Array.from(view.container.querySelectorAll('.status-page > .system-status-snapshot'));
    expect(view.container.querySelectorAll('.status-page > .system-status-snapshot')).toHaveLength(1);
    expect(intro?.textContent).toContain('Backend responded with a status snapshot');
    const smoke = screen.getByRole('heading', { name: 'Recorded smoke check' }).closest('.system-status-panel');
    expect(smoke?.querySelectorAll(':scope > .system-status-snapshot')).toHaveLength(1);
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

  it('renders the reduced mirror view and reveals paths only on expansion', async () => {
    const report = snapshot();
    report.vaultMirror = {
      state: 'needs-attention', reason: 'conflict', writeBack: 'dry-run',
      lastSuccessAt: new Date().toISOString(), conflictPaths: ['Notes/synthetic-conflict.md'],
    };
    fetchMock.mockResolvedValue(response(report));
    render(<StatusPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    await screen.findByText('Needs attention');
    const mirror = screen.getByRole('group', { name: 'Vault mirror' });
    expect(within(mirror).getByText('Needs attention')).not.toBeNull();
    expect(within(mirror).getByText('Dry-run')).not.toBeNull();
    expect(screen.queryByText('Notes/synthetic-conflict.md')).toBeNull();
    fireEvent.click(within(mirror).getByRole('button', { name: 'Vault mirror details' }));
    expect(within(mirror).getByText('Notes/synthetic-conflict.md')).not.toBeNull();
  });

  it('rejects a raw mirror document instead of rendering unvalidated fields', async () => {
    fetchMock.mockResolvedValue(response({
      ...snapshot(),
      vaultMirror: { state: 'healthy', lastSuccessAt: null, noteText: 'synthetic forbidden content' },
    }));
    render(<StatusPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/invalid system status response/);
    expect(screen.queryByText('synthetic forbidden content')).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Vault mirror' })).getByText('Read error')).not.toBeNull();
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
