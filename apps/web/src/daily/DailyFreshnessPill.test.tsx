import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DailyFreshnessPill } from './DailyFreshnessPill';
import { dailyFixture, jsonResponse } from './test-support';

const token = async () => 'synthetic-fixture';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function pill(enabled = true) {
  return render(<DailyFreshnessPill backendUrl="http://localhost:3999" getAccessToken={token} enabled={enabled} refreshVersion={0} />);
}

const upload = { feed_kind: 'synthetic', accepted_evidence_at: '2026-10-17T08:30:00Z' };

describe('DailyFreshnessPill', () => {
  it('shows the newest processed upload and the counts in a popover that Escape closes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => jsonResponse(dailyFixture(
      JSON.parse(String(init?.body)),
      [{ feeds: [{ feed_kind: 'older', accepted_evidence_at: '2026-10-16T07:00:00Z' }, upload], heartbeat: null, inbox: { accepted: 4, processing: 1, quarantined: 0 } }],
    ))));
    const user = userEvent.setup();
    pill();
    const trigger = await screen.findByRole('button', { name: /^Last upload \d/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByRole('group', { name: 'Sync details' });
    expect(panel.textContent).toContain('Accepted uploads');
    expect(panel.textContent).not.toContain('Phone last contacted');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Sync details' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('lists the phone heartbeat as a separate row only when one is present', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => jsonResponse(dailyFixture(
      JSON.parse(String(init?.body)),
      [{ feeds: [upload], heartbeat: { last_received_at: '2026-10-17T09:00:00Z' }, inbox: { accepted: 1, processing: 0, quarantined: 0 } }],
    ))));
    const user = userEvent.setup();
    pill();
    await user.click(await screen.findByRole('button', { name: /^Last upload \d/ }));
    expect(screen.getByRole('group', { name: 'Sync details' }).textContent).toContain('Phone last contacted');
  });

  it('flags retained data as stale when a refresh fails, and Escape closes the panel after focus has left it', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      calls += 1;
      if (calls > 1) return jsonResponse({ error: 'synthetic failure' }, 500);
      return jsonResponse(dailyFixture(JSON.parse(String(init?.body)),
        [{ feeds: [upload], heartbeat: null, inbox: { accepted: 1, processing: 0, quarantined: 0 } }]));
    }));
    const user = userEvent.setup();
    render(<><DailyFreshnessPill backendUrl="http://localhost:3999" getAccessToken={token} enabled refreshVersion={0} />
      <button type="button">Elsewhere</button></>);
    const trigger = await screen.findByRole('button', { name: /^Last upload \d/ });
    expect(trigger.getAttribute('data-state')).toBe('ready');
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(trigger.textContent).toMatch(/^Last upload .+, refresh failed$/));
    expect(trigger.getAttribute('data-state')).toBe('error');
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Sync details' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
  });

  it.each([
    ['pending', { pending: 2, processing: 0, quarantined: 0 }],
    ['processing', { pending: 0, processing: 1, quarantined: 0 }],
  ])('says the upload is being processed when it is %s and no feed has a processed time', async (_name, inbox) => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => jsonResponse(dailyFixture(
      JSON.parse(String(init?.body)), [{ feeds: [{ feed_kind: 'synthetic', accepted_evidence_at: null }], heartbeat: null, inbox }],
    ))));
    pill();
    expect(await screen.findByRole('button', { name: 'Upload being processed' })).toBeTruthy();
  });

  it('says there are no uploads yet only when nothing is processed or waiting, even with a heartbeat', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => jsonResponse(dailyFixture(
      JSON.parse(String(init?.body)),
      [{ feeds: [], heartbeat: { last_received_at: '2026-10-17T09:00:00Z' }, inbox: { pending: 0, processing: 0, quarantined: 0 } }],
    ))));
    pill();
    expect(await screen.findByRole('button', { name: 'No uploads yet' })).toBeTruthy();
  });

  it('reports a failed read instead of inventing a time, and renders nothing when sync is not served', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'synthetic failure' }, 500)));
    const view = pill();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sync status unavailable' })).toBeTruthy());
    view.unmount();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const hidden = pill(false);
    expect(hidden.container.textContent).toBe('');
    expect(fetch).not.toHaveBeenCalled();
  });
});
