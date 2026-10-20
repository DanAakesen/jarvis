import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DailyJson } from '@jarvis/contracts';
import { DailyFreshnessPill } from './DailyFreshnessPill';
import { dailyFixture, jsonResponse } from './test-support';

const token = async () => 'synthetic-fixture';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

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

  async function storedRow(inbox: Record<string, DailyJson>) {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => jsonResponse(dailyFixture(
      JSON.parse(String(init?.body)), [{ feeds: [upload], heartbeat: null, inbox }],
    ))));
    const user = userEvent.setup();
    pill();
    await user.click(await screen.findByRole('button', { name: /^Last upload \d/ }));
    return screen.getByText('Stored').closest('div')!;
  }
  const mib = 1024 * 1024;

  it('shows stored size against the byte and row caps in the details panel', async () => {
    const row = await storedRow({ retained: 12, retained_bytes: 3.25 * mib, byte_limit: 256 * mib, row_limit: 1000, processing: 0 });
    expect(row.querySelector('dd')?.textContent).toBe('3.3 of 256 MiB · 12 of 1000 uploads');
  });

  it('shows zero stored when the inbox is empty, without a nearly full flag', async () => {
    const row = await storedRow({ retained: 0, retained_bytes: 0, byte_limit: 256 * mib, row_limit: 1000 });
    expect(row.querySelector('dd')?.textContent).toBe('0.0 of 256 MiB · 0 of 1000 uploads');
    expect(row.textContent).not.toContain('nearly full');
  });

  it('adds the words nearly full when either figure reaches 80% of its cap', async () => {
    const bytes = await storedRow({ retained: 5, retained_bytes: 205 * mib, byte_limit: 256 * mib, row_limit: 1000 });
    expect(bytes.querySelector('dd')?.textContent).toBe('205.0 of 256 MiB · 5 of 1000 uploads · nearly full');
    expect(bytes.querySelector('strong')?.textContent).toBe('nearly full');
    cleanup();
    const rows = await storedRow({ retained: 800, retained_bytes: mib, byte_limit: 256 * mib, row_limit: 1000 });
    expect(rows.querySelector('dd')?.textContent).toBe('1.0 of 256 MiB · 800 of 1000 uploads · nearly full');
    cleanup();
    const below = await storedRow({ retained: 799, retained_bytes: 204 * mib, byte_limit: 256 * mib, row_limit: 1000 });
    expect(below.textContent).not.toContain('nearly full');
  });

  it('reads Unknown for any missing or non-finite figure, and never flags a cap it cannot compare', async () => {
    const partial = await storedRow({ retained: 4, retained_bytes: null, byte_limit: 256 * mib, row_limit: 'many' });
    expect(partial.querySelector('dd')?.textContent).toBe('Unknown of 256 MiB · 4 of Unknown uploads');
    expect(partial.textContent).not.toContain('nearly full');
    cleanup();
    const none = await storedRow({ accepted: 1, processing: 0, quarantined: 0 });
    expect(none.querySelector('dd')?.textContent).toBe('Unknown');
  });

  it('reports a failed read instead of inventing a time, and renders nothing when sync is not served', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'synthetic failure' }, 500)));
    const view = pill();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sync status unavailable' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Sync status unavailable' }).getAttribute('data-freshness')).toBe('behind');
    view.unmount();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const hidden = pill(false);
    expect(hidden.container.textContent).toBe('');
    expect(fetch).not.toHaveBeenCalled();
  });

  async function dotAt(now: string) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(now));
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => jsonResponse(dailyFixture(
      JSON.parse(String(init?.body)), [{ feeds: [upload], heartbeat: null, inbox: { accepted: 1, processing: 0, quarantined: 0 } }],
    ))));
    pill();
    return (await screen.findByRole('button', { name: /^Last upload \d/ })).getAttribute('data-freshness');
  }

  it('turns the dot amber only when the newest upload is more than 36 hours old', async () => {
    expect(await dotAt('2026-10-17T20:00:00Z')).toBe('recent');
    cleanup();
    expect(await dotAt('2026-10-19T08:31:00Z')).toBe('behind');
  });

  it('lists each source in the Last sync table and says Not received instead of a time when a feed has none', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => jsonResponse(dailyFixture(
      JSON.parse(String(init?.body)),
      [{
        feeds: [
          { feed_kind: 'metrics', accepted_evidence_at: '2026-10-17T08:30:00Z' },
          { feed_kind: 'workouts', accepted_evidence_at: null },
          { feed_kind: 'sketchy', accepted_evidence_at: 'not a time' },
          { feed_kind: '', accepted_evidence_at: '2026-10-17T08:30:00Z' },
        ],
        heartbeat: null, inbox: { accepted: 1, processing: 0, quarantined: 0 },
      }],
    ))));
    const user = userEvent.setup();
    pill();
    await user.click(await screen.findByRole('button', { name: /^Last upload \d/ }));
    const table = screen.getByRole('table', { name: 'Last sync by source' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map(item => within(item).getByRole('rowheader').textContent)).toEqual(['Health metrics', 'Workouts', 'Sketchy']);
    expect(within(rows[0]!).getByRole('cell').textContent).toMatch(/^\d/u);
    expect(within(rows[1]!).getByRole('cell').textContent).toBe('Not received');
    expect(within(rows[2]!).getByRole('cell').textContent).toBe('Not received');
  });

  it('never shows a time or a green dot when every upload time is unparseable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => jsonResponse(dailyFixture(
      JSON.parse(String(init?.body)),
      [{ feeds: [{ feed_kind: 'sketchy', accepted_evidence_at: 'not a time' }], heartbeat: null, inbox: { accepted: 0, processing: 0, quarantined: 0 } }],
    ))));
    pill();
    const trigger = await screen.findByRole('button', { name: 'No uploads yet' });
    expect(trigger.getAttribute('data-freshness')).toBe('behind');
  });
});
