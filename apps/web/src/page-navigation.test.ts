import { describe, expect, it } from 'vitest';
import { isWorkspaceSnapshot } from '@jarvis/contracts';
import { pageForPath, readConversationCommand, readNavigateCommand, resolveNavigation } from './page-navigation';

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
    expect(resolveNavigation({ page: 'knowledge' })).toEqual({ ok: true, path: '/knowledge' });
    expect(resolveNavigation({ page: 'settings', section: 'routines' }))
      .toEqual({ ok: true, path: '/settings', anchorId: 'task-recipes-heading' });
    expect(resolveNavigation({ page: 'factory', taskId: '42' })).toEqual({ ok: true, path: '/factory/kanban', taskId: '42' });
  });

  it('refuses unknown, unbuilt or malformed targets with a reason', () => {
    expect(resolveNavigation({ page: 'folio' })).toEqual({ ok: true, pane: 'folio' });
    for (const request of [{ page: 'folio', section: 'x' }, { page: 'status' }, { page: 'nowhere' }, { page: 'settings', section: 'nope' },
      { page: 'usage', section: 'voice' }, { page: 'factory', taskId: 'abc' }, { page: 'home', taskId: '42' }]) {
      const result = resolveNavigation(request);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('names the page Dan is looking at and builds a valid snapshot view', () => {
    expect(['/', '/factory/kanban', '/factory/tasks/42', '/settings', '/usage', '/knowledge', '/nowhere'].map(pageForPath))
      .toEqual(['home', 'factory', 'factory', 'settings', 'usage', 'knowledge', 'home']);
    expect(isWorkspaceSnapshot({
      windows: [{ viewId: 'task-42', title: 'Task 42' }], contextPanelOpen: false,
      view: { page: 'factory', taskId: '42', folioOpen: false, focusedViewId: 'task-42', previous: { page: 'settings', section: 'voice' } },
    })).toBe(true);
  });

  it('reads Jarvis showing or hiding the conversation', () => {
    expect(readConversationCommand({ commandId: '1', operation: 'conversation', action: 'show' })).toBe('show');
    expect(readConversationCommand({ commandId: '1', operation: 'conversation', action: 'hide' })).toBe('hide');
    expect(readConversationCommand({ commandId: '1', operation: 'conversation', action: 'toggle' })).toBeNull();
    expect(readConversationCommand({ commandId: '1', operation: 'focus', viewId: 'x' })).toBeNull();
  });
});