import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemStatus } from '@jarvis/contracts';
import { StatusPage } from './StatusPage';

const checkedAt = () => new Date().toISOString();

function snapshot(): SystemStatus {
  const ids = [
    'database', 'foundry.chat', 'foundry.voice', 'foundry.embeddings', 'vault_index',
    'github_app', 'google', 'pc_bridge', 'runner', 'deployed_commit', 'last_error',
  ] as const;
  return {
    checkedAt: checkedAt(),
    vaultMirror: {
      state: 'not-set-up',
      lastSuccessAt: null,
      readReason: 'status-missing',
    },
    entries: ids.map(id => ({
      id,
      status: id === 'foundry.chat' || id === 'foundry.voice' || id === 'runner' ? 'unknown' : 'ok',
      checkedAt: checkedAt(),
      details: id === 'foundry.chat' || id === 'foundry.voice'
        ? { configured: true, engine: 'pi', runtimeProbe: 'not_run' }
        : id === 'runner'
          ? { configured: true, activeSessions: 0, healthProbe: 'not_run' }
          : id === 'last_error'
            ? {
              occurredAt: '2026-11-18T20:00:00.000Z', route: '/synthetic', statusCode: 503,
              recent: false, observedSince: '2026-11-18T19:00:00.000Z',
            }
            : {},
    })),
  };
}

describe('StatusPage evidence copy', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(snapshot())));
  });

  it('does not equate a missing mirror blob with an inactive job', async () => {
    render(<StatusPage backendUrl="https://api.example.test" getAccessToken={async () => 'token'} />);
    expect(await screen.findByText('No status yet')).not.toBeNull();
    const button = screen.getByRole('button', { name: 'Vault mirror details' });
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/does not establish whether the scheduled job exists or ran/u)).not.toBeNull();
  });

  it('explains never-probed PI and historical backend-error rows', async () => {
    render(<StatusPage backendUrl="https://api.example.test" getAccessToken={async () => 'token'} />);
    expect(await screen.findAllByText('The active PI engine is configured, but no recent runtime result is recorded for this capability.')).toHaveLength(2);
    expect(screen.getByText(/No recent backend server error is recorded\. The last one was at/u)).not.toBeNull();
    expect(screen.getByText('The runner is configured, but no runtime probe has completed for this backend process.')).not.toBeNull();
  });

  it('does not downgrade a fresh PI runtime success into unconfirmed catalogue copy', async () => {
    const data = snapshot();
    data.entries = data.entries.map(entry => entry.id === 'foundry.chat' ? {
      ...entry,
      status: 'ok',
      details: {
        configured: true, engine: 'pi', evidence: 'runtime-turn',
        channel: 'chat', source: 'brain', outcome: 'ok',
      },
    } : entry);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(data)));
    render(<StatusPage backendUrl="https://api.example.test" getAccessToken={async () => 'token'} />);
    await screen.findByLabelText('Foundry chat');
    expect(screen.queryByText('The required model deployment could not be confirmed.')).toBeNull();
  });

  it('keeps the last mirror snapshot visible when a later refresh fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json(snapshot()))
      .mockRejectedValueOnce(new TypeError('offline')));
    render(<StatusPage backendUrl="https://api.example.test" getAccessToken={async () => 'token'} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh status' }));
    expect(await screen.findByText('The last status snapshot remains visible.')).not.toBeNull();
    expect(screen.getByText('No status yet')).not.toBeNull();
    expect(screen.queryByText('Read error')).toBeNull();
  });

  it('shows the exact mirror guard and proposed change counts', async () => {
    const data = snapshot();
    data.vaultMirror = {
      state: 'needs-attention',
      lastSuccessAt: null,
      lastRunAt: checkedAt(),
      outcome: 'needs-attention',
      reason: 'guard-tripped',
      guardReasons: ['max-changed-G'],
      changedOnGitHub: 26,
      changedOnObsidian: 11,
    };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(data)));
    render(<StatusPage backendUrl="https://api.example.test" getAccessToken={async () => 'token'} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vault mirror details' }));
    expect(screen.getByText(/per-run cap would be exceeded by changes to GitHub/u)).not.toBeNull();
    expect(screen.getByText('Proposed GitHub changes')).not.toBeNull();
    expect(screen.getByText('26')).not.toBeNull();
  });
});
