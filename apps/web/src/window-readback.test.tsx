import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isWorkspaceSnapshot } from '@jarvis/contracts';
import { Workspace, type WorkspaceView } from './Workspace';
import { boundText, generatedViewReadback, readableText, redactSecrets, reportFrameReadback, selectedTextWithin } from './window-readback';
import { htmlAppDocument, readHtmlAppMessage } from './html-app-document';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function mount(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

describe('window readback', () => {
  it('reads visible text and never form values, hidden parts or secrets', () => {
    const root = mount(`<h2>Plan</h2><p>Ship it</p><input value="typed draft"><textarea>unsent note</textarea>
      <input type="password" value="hunter2"><p hidden>hidden</p><div aria-hidden="true">aria</div><script>var a=1</script>
      <p>The token: s3cr3t is private</p>`);
    const text = readableText(root);
    expect(text).toContain('Plan');
    expect(text).toContain('Ship it');
    for (const leaked of ['typed draft', 'unsent note', 'hunter2', 'hidden', 'aria', 'var a', 's3cr3t']) expect(text).not.toContain(leaked);
    root.remove();
  });

  it('bounds text by UTF-8 bytes and keeps the snapshot valid', () => {
    const bounded = boundText('é'.repeat(10_000), 8 * 1024);
    expect(new TextEncoder().encode(bounded).byteLength).toBeLessThanOrEqual(8 * 1024);
    expect(redactSecrets('ghp_abcdefghijklmnopqrstuvwx')).toBe('[redacted]');
    expect(isWorkspaceSnapshot({ windows: [{ viewId: 'a', title: 'A', content: bounded }], contextPanelOpen: false })).toBe(true);
  });

  it('reports a selection inside the root only', () => {
    const root = mount('<p id="a">Revenue rose 12 percent</p><p id="b">elsewhere</p>');
    const inside = root.querySelector('#a')!.firstChild!;
    const range = document.createRange();
    range.setStart(inside, 0);
    range.setEnd(inside, 7);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selectedTextWithin(root.querySelector('#a')!)).toBe('Revenue');
    expect(selectedTextWithin(root.querySelector('#b')!)).toBe('');
    selection.removeAllRanges();
    root.remove();
  });

  it('describes chart series with units and timeline events', () => {
    expect(generatedViewReadback({
      renderer: 'chart', title: 'Sales', source: { id: 'x', status: 'ready' },
      data: { kind: 'line', series: [{ name: 'Revenue (kr)', points: [{ x: 2024, y: 10 }, { x: 2025, y: 12 }] }] },
    } as never)).toContain('Revenue (kr): 2024=10, 2025=12');
    expect(generatedViewReadback({
      renderer: 'timeline', title: 'T', source: { id: 'x', status: 'ready' },
      data: { events: [{ at: '2024-01-01', title: 'Start', description: 'Kick-off' }, { label: '2009/10', title: 'Season' }] },
    } as never)).toBe('2024-01-01 - Start - Kick-off\n2009/10 - Season');
  });

  it('accepts only bounded bridge readback messages', () => {
    expect(readHtmlAppMessage({ jarvisBridge: 1, type: 'readback', content: 'Report text', selection: '' }))
      .toEqual({ type: 'readback', content: 'Report text', selection: '' });
    expect(readHtmlAppMessage({ jarvisBridge: 1, type: 'readback', content: 'x'.repeat(20_000), selection: '' })).toBeNull();
    expect(readHtmlAppMessage({ jarvisBridge: 1, type: 'readback', content: 1, selection: '' })).toBeNull();
    expect(htmlAppDocument('<p>hi</p>', { scheme: 'dark', tokens: {} })).toContain("type: 'readback'");
  });

  it('sends task-window content and a chart view in the snapshot after the debounce', () => {
    vi.useFakeTimers();
    const onOpenWindowsChange = vi.fn();
    const views: WorkspaceView[] = [
      { id: 'task-1', title: 'Task one', content: { status: 'ready', content: <p>Build the widget <input defaultValue="draft" /></p> } },
      { id: 'chart', title: 'Chart', content: { status: 'generated', view: {
        renderer: 'chart', title: 'Sales', source: { id: 'x', status: 'ready' },
        data: { kind: 'bar', series: [{ name: 'Units sold', points: [{ x: 'Q1', y: 4 }] }] },
      } as never } },
    ];
    render(<Workspace views={views} onOpenWindowsChange={onOpenWindowsChange} />);
    expect(onOpenWindowsChange.mock.lastCall?.[0]).toEqual([{ viewId: 'task-1', title: 'Task one' }, { viewId: 'chart', title: 'Chart' }]);
    act(() => { vi.advanceTimersByTime(500); });
    const windows = onOpenWindowsChange.mock.lastCall?.[0] as { viewId: string; content?: string }[];
    expect(windows[0]!.content).toBe('Build the widget');
    expect(windows[1]!.content).toContain('Units sold: Q1=4');
    expect(isWorkspaceSnapshot({ windows, contextPanelOpen: false })).toBe(true);
  });

  it('uses the report frame readback for HTML reports and forgets it when cleared', () => {
    vi.useFakeTimers();
    const onOpenWindowsChange = vi.fn();
    const views: WorkspaceView[] = [{ id: 'report', title: 'Report', content: { status: 'ready', content: <iframe className="html-app-frame" title="r" /> } }];
    const { container } = render(<Workspace views={views} onOpenWindowsChange={onOpenWindowsChange} />);
    const frame = container.querySelector('iframe')!;
    act(() => { reportFrameReadback(frame, { content: 'Findings: cats', selection: 'cats' }); vi.advanceTimersByTime(500); });
    expect(onOpenWindowsChange.mock.lastCall?.[0]).toEqual([{ viewId: 'report', title: 'Report', content: 'Findings: cats', selection: 'cats' }]);
    act(() => { reportFrameReadback(frame, null); vi.advanceTimersByTime(500); });
    expect(onOpenWindowsChange.mock.lastCall?.[0]).toEqual([{ viewId: 'report', title: 'Report' }]);
  });

  it('runs the frame bridge: visible text and selection out, form values and hidden parts never', async () => {
    document.body.innerHTML = '<p>Report body</p><input value="typed secret"><p style="display:none">gone</p><script>1</script>';
    const html = htmlAppDocument('', { scheme: 'dark', tokens: {} });
    const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
    const messages: unknown[] = [];
    const listener = (event: MessageEvent) => messages.push(event.data);
    window.addEventListener('message', listener);
    new Function(script)();
    await new Promise((resolve) => setTimeout(resolve, 600));
    window.removeEventListener('message', listener);
    const readback = messages.map(readHtmlAppMessage).find((message) => message?.type === 'readback');
    expect(readback).toMatchObject({ type: 'readback', content: 'Report body' });
    document.body.innerHTML = '';
  });
});
