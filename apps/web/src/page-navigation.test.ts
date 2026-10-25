import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { isWorkspaceSnapshot } from '@jarvis/contracts';
import { pageForPath, readConversationCommand, readNavigateCommand, resolveNavigation, revealWhenReady, useFocusedFactoryIssue, waitForFactoryIssue, type FactoryIssueTarget } from './page-navigation';

afterEach(() => vi.useRealTimers());

describe('page navigation', () => {
  it('reads only navigate commands', () => {
    expect(readNavigateCommand({ commandId: '1', operation: 'navigate', page: 'settings', section: 'voice' }))
      .toEqual({ page: 'settings', section: 'voice' });
    expect(readNavigateCommand({ commandId: '1', operation: 'focus', viewId: 'x' })).toBeNull();
    expect(readNavigateCommand({ operation: 'navigate' })).toBeNull();
  });

  it('maps pages, Settings sections and tasks to routes', () => {
    expect(resolveNavigation({ page: 'home' })).toEqual({ ok: true, path: '/' });
    expect(resolveNavigation({ page: 'factory' })).toEqual({ ok: true, path: '/factory/kanban' });
    expect(resolveNavigation({ page: 'knowledge' })).toEqual({ ok: true, path: '/notes' });
    expect(resolveNavigation({ page: 'notes' })).toEqual({ ok: true, path: '/notes' });
    expect(resolveNavigation({ page: 'status' })).toEqual({ ok: true, path: '/status' });
    expect(resolveNavigation({ page: 'daily' }, true)).toEqual({ ok: true, path: '/health' });
    expect(resolveNavigation({ page: 'health' }, true)).toEqual({ ok: true, path: '/health' });
    expect(resolveNavigation({ page: 'settings', section: 'routines' }))
      .toEqual({ ok: true, path: '/settings', anchorId: 'routines-heading' });
    expect(resolveNavigation({ page: 'factory', taskId: '42' })).toEqual({ ok: true, path: '/factory/kanban', taskId: '42' });
  });

  it('retains positive whole issue numbers and refuses malformed or non-Factory issue targets', () => {
    expect(readNavigateCommand({ operation: 'navigate', page: 'factory', issueNumber: 793 }))
      .toEqual({ page: 'factory', issueNumber: 793 });
    expect(resolveNavigation({ page: 'factory', issueNumber: 793 }))
      .toEqual({ ok: true, path: '/factory/kanban', issueNumber: 793 });
    for (const issueNumber of [0, -1, 1.5, '793', null, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(readNavigateCommand({ operation: 'navigate', page: 'factory', issueNumber })).toBeNull();
    }
    expect(resolveNavigation({ page: 'settings', issueNumber: 793 }).ok).toBe(false);
    expect(resolveNavigation({ page: 'factory', issueNumber: 793, taskId: 'bad' }).ok).toBe(false);
  });

  it('waits for page-owned issue data rather than treating a route change as success', async () => {
    vi.useFakeTimers();
    let target: FactoryIssueTarget = { status: 'loading' };
    const result = waitForFactoryIssue(() => target, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(120);
    target = { status: 'ready', anchorId: 'issue-title-793' };
    await vi.advanceTimersByTimeAsync(120);
    expect(await result).toEqual(target);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('expands a task card column before the existing task-id reveal scrolls and highlights it', async () => {
    vi.useFakeTimers();
    const column = document.createElement('section');
    column.className = 'kanban-column';
    column.innerHTML = '<button class="kanban-column-toggle" aria-expanded="false">Done</button><article class="kanban-card"><h3>Task</h3></article>';
    const toggle = column.querySelector('button')!;
    toggle.addEventListener('click', () => toggle.setAttribute('aria-expanded', 'true'));
    const card = column.querySelector('article')!;
    card.scrollIntoView = vi.fn();
    const cancel = revealWhenReady(() => column.querySelector('h3'), true);
    await vi.advanceTimersByTimeAsync(60);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(card.scrollIntoView).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120);
    expect(card.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
    expect(card.hasAttribute('data-navigated')).toBe(true);
    cancel();
    expect(card.hasAttribute('data-navigated')).toBe(false);
  });

  it('settles a board failure, command cancellation and the acknowledgement deadline without late lookups', async () => {
    vi.useFakeTimers();
    const missing: FactoryIssueTarget = { status: 'refused', reason: 'Issue not found.' };
    expect(await waitForFactoryIssue(() => missing, new AbortController().signal)).toEqual(missing);
    const controller = new AbortController();
    const find = vi.fn(() => null);
    const cancelled = waitForFactoryIssue(find, controller.signal);
    controller.abort();
    expect(await cancelled).toMatchObject({ status: 'refused', reason: 'Issue navigation was cancelled.' });
    const expired = waitForFactoryIssue(find, new AbortController().signal, Date.now() + 1000);
    await vi.advanceTimersByTimeAsync(750);
    expect(await expired).toMatchObject({ status: 'refused', reason: expect.stringContaining('still loading') });
    const calls = find.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(find).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses unknown or malformed targets with a reason', () => {
    expect(resolveNavigation({ page: 'workspaces' })).toEqual({ ok: true, pane: 'workspaces' });
    expect(resolveNavigation({ page: 'folio' })).toEqual({ ok: true, pane: 'workspaces' });
    for (const request of [{ page: 'workspaces', section: 'x' }, { page: 'folio', section: 'x' }, { page: 'status', taskId: '42' }, { page: 'status', section: 'voice' }, { page: 'nowhere' }, { page: 'settings', section: 'nope' },
      { page: 'settings', section: 'backend' }, { page: 'usage', section: 'voice' }, { page: 'factory', taskId: 'abc' }, { page: 'home', taskId: '42' }]) {
      const result = resolveNavigation(request);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('names the page Dan is looking at and builds a valid snapshot view', () => {
    expect(['/', '/factory/kanban', '/factory/tasks/42', '/settings', '/usage', '/status', '/notes', '/knowledge', '/nowhere'].map(path => pageForPath(path)))
      .toEqual(['home', 'factory', 'factory', 'settings', 'usage', 'status', 'notes', 'knowledge', 'home']);
    expect(pageForPath('/daily')).toBe('home');
    expect(pageForPath('/health')).toBe('home');
    expect(pageForPath('/daily', true)).toBe('health');
    expect(pageForPath('/health', true)).toBe('health');
    for (const page of ['daily', 'health'] as const) {
      const refused = resolveNavigation({ page });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.reason).not.toMatch(/\bdaily\b/iu);
      expect(resolveNavigation({ page }, true)).toEqual({ ok: true, path: '/health' });
    }
    expect(isWorkspaceSnapshot({
      windows: [], contextPanelOpen: false, view: { page: 'factory', issueNumber: 793 },
    })).toBe(true);
    expect(isWorkspaceSnapshot({
      windows: [], contextPanelOpen: false,
      view: { page: pageForPath('/notes'), previous: { page: 'knowledge' } },
    })).toBe(true);
    expect(isWorkspaceSnapshot({
      windows: [{ viewId: 'task-42', title: 'Task 42' }], contextPanelOpen: false,
      view: { page: 'factory', taskId: '42', folioOpen: false, focusedViewId: 'task-42', previous: { page: 'settings', section: 'voice' } },
    })).toBe(true);
  });

  it('tracks real issue focus and clears the selector on other focus, hidden/removed cards and page changes', async () => {
    const board = document.createElement('div');
    board.className = 'kanban-board';
    board.innerHTML = '<article class="kanban-card" aria-labelledby="issue-title-793"><h3 id="issue-title-793"><a href="#issue">Issue</a></h3></article><input aria-label="Search">';
    document.body.append(board);
    const card = board.querySelector('article')!;
    const title = board.querySelector('a')!;
    const search = board.querySelector('input')!;
    const hook = renderHook(({ active }) => useFocusedFactoryIssue(active), { initialProps: { active: true } });
    expect(hook.result.current).toBeUndefined();
    act(() => title.focus());
    expect(hook.result.current).toBe(793);
    act(() => search.focus());
    expect(hook.result.current).toBeUndefined();
    act(() => title.focus());
    await act(async () => { card.hidden = true; });
    expect(hook.result.current).toBeUndefined();
    await act(async () => { card.hidden = false; });
    expect(hook.result.current).toBe(793);
    hook.rerender({ active: false });
    expect(hook.result.current).toBeUndefined();
    hook.rerender({ active: true });
    expect(hook.result.current).toBe(793);
    await act(async () => { card.remove(); });
    expect(hook.result.current).toBeUndefined();
    hook.unmount();
    board.remove();
  });

  it('reads Jarvis showing or hiding the conversation', () => {
    expect(readConversationCommand({ commandId: '1', operation: 'conversation', action: 'show' })).toBe('show');
    expect(readConversationCommand({ commandId: '1', operation: 'conversation', action: 'hide' })).toBe('hide');
    expect(readConversationCommand({ commandId: '1', operation: 'conversation', action: 'toggle' })).toBeNull();
    expect(readConversationCommand({ commandId: '1', operation: 'focus', viewId: 'x' })).toBeNull();
  });
});