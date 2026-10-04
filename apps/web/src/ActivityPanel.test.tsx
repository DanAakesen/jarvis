import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityPanel } from './ActivityPanel';
import { activityHref, formatDuration, type NowFeed } from './activity';

const feed: NowFeed = {
  status: 'ready',
  awayMode: false,
  updatedAt: '2026-10-03T12:00:00Z',
  running: [
    { id: '42', title: 'Add the release view', project: 'Jarvis', agent: 'codex', activity: 'Running tests', startedAt: '2026-10-03T10:55:00Z' },
  ],
  items: [
    { id: '1', category: 'attention', title: 'Sandbox crashed', link: 'task:43', at: '2026-10-03T11:50:00Z' },
    { id: '2', category: 'release', title: 'Release 7 deployed', link: 'release:7', at: '2026-10-03T11:40:00Z' },
    { id: '3', category: 'credential', title: 'Codex login expires in 3 days', link: null, at: '2026-10-03T09:00:00Z' },
    { id: '4', category: 'release', title: 'Unexpected link', link: 'javascript:alert(1)', at: '2026-10-03T09:00:00Z' },
    { id: '5', category: 'alert', title: 'Monthly budget reached 80%', link: null, at: '2026-10-03T08:00:00Z' },
  ],
};

function renderPanel(props: Parameters<typeof ActivityPanel>[0]) {
  return render(<MemoryRouter><ActivityPanel {...props} /></MemoryRouter>);
}

function section(name: string) {
  return screen.getByRole('region', { name });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('activity panel', () => {
  it('explains that activity is unavailable without inventing items', () => {
    renderPanel({ feed: { status: 'unavailable', message: "Activity isn't available yet." } });

    expect(screen.getByText("Activity isn't available yet.")).not.toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows running tasks with project, agent, activity and duration', () => {
    renderPanel({ feed, onDismiss: vi.fn() });

    const running = section('Running tasks');
    expect(within(running).getByRole('link', { name: 'Add the release view' }).getAttribute('href')).toBe('/factory/tasks/42');
    expect(within(running).getAllByRole('definition').map((value) => value.textContent))
      .toEqual(['Jarvis', 'Codex', 'Running tests', '1 h 05 min']);
    expect(screen.getByText(/Updated/).querySelector('time')?.getAttribute('dateTime')).toBe(feed.updatedAt);
  });

  it('groups activity items and opens tasks and releases', () => {
    renderPanel({ feed, onDismiss: vi.fn() });

    expect(within(section('Needs attention')).getByRole('link', { name: 'Sandbox crashed' }).getAttribute('href')).toBe('/factory/tasks/43');
    const releases = section('Releases and deployments');
    expect(within(releases).getByRole('link', { name: 'Release 7 deployed' }).getAttribute('href')).toBe('/factory/releases/7');
    expect(within(releases).queryByRole('link', { name: 'Unexpected link' })).toBeNull();
    expect(within(releases).getByText('Unexpected link')).not.toBeNull();
    expect(within(section('Credential warnings')).queryByRole('link')).toBeNull();
    expect(within(section('Alerts')).getByText('Monthly budget reached 80%')).not.toBeNull();
  });

  it('shows empty states for each group', () => {
    renderPanel({ feed: { status: 'ready', awayMode: false, updatedAt: feed.updatedAt, running: [], items: [] }, onDismiss: vi.fn() });

    for (const text of ['No tasks are running.', 'No tasks need attention.', 'No recent releases or deployments.', 'No credential warnings.', 'No active alerts.']) {
      expect(screen.getByText(text)).not.toBeNull();
    }
    expect(screen.getByRole('status').textContent).toContain('Away mode is off.');
  });

  it('shows the phone-first mode while away', () => {
    renderPanel({ feed: { ...feed, awayMode: true }, onDismiss: vi.fn() });

    expect(screen.getByRole('status').textContent).toContain('Task updates and confirmations go to Teams');
  });

  it('dismisses an item once the backend confirms it', async () => {
    const user = userEvent.setup();
    let confirm: () => void = () => undefined;
    const onDismiss = vi.fn(() => new Promise<void>((resolve) => { confirm = resolve; }));
    renderPanel({ feed, onDismiss });

    await user.click(screen.getByRole('button', { name: 'Dismiss Sandbox crashed' }));
    const pending = screen.getByRole('button', { name: 'Dismissing Sandbox crashed' });
    expect(pending).toHaveProperty('disabled', true);
    await user.click(pending);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith('1');

    confirm();
    expect(await screen.findByText('No tasks need attention.')).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Now' }));
  });

  it('keeps an item and explains a failed dismissal', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    renderPanel({ feed, onDismiss });

    await user.click(screen.getByRole('button', { name: 'Dismiss Release 7 deployed' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Jarvis could not dismiss this item. Try again.');
    expect(screen.getByRole('link', { name: 'Release 7 deployed' })).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Dismiss Release 7 deployed' }));
    expect(screen.queryByRole('link', { name: 'Release 7 deployed' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('disables dismissal with an explanation when no dismiss action is connected', () => {
    renderPanel({ feed });

    expect(screen.getByRole('button', { name: 'Dismiss Sandbox crashed', description: "Dismissing isn't available yet." }))
      .toHaveProperty('disabled', true);
  });
});

describe('activity helpers', () => {
  it.each([
    ['task:42', '/factory/tasks/42'],
    ['project:3', '/factory/projects/3'],
    ['release:7', '/factory/releases/7'],
    ['task:0', null],
    ['task:42/extra', null],
    ['https://example.com', null],
    [null, null],
  ])('maps %s to %s', (link, href) => {
    expect(activityHref(link)).toBe(href);
  });

  it.each([
    ['2026-10-03T12:00:00Z', 'Under 1 min'],
    ['2026-10-03T11:48:00Z', '12 min'],
    ['2026-10-03T09:58:00Z', '2 h 02 min'],
    ['not a date', 'Unknown'],
  ])('formats a duration since %s as %s', (startedAt, text) => {
    expect(formatDuration(startedAt, Date.parse('2026-10-03T12:00:00Z'))).toBe(text);
  });
});
