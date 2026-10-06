import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HtmlAppFrame } from './HtmlAppFrame';

describe('HTML app iframe boundary', () => {
  it('loads through the host and enforces the required sandbox and CSP', async () => {
    const frameHtml = '<h1>Research</h1><script>parent.document.body.innerHTML = "unsafe"</script>';
    const loadArtifact = vi.fn(async () => ({
      id: '12345678-1234-4234-8234-123456789abc',
      kind: 'html' as const,
      title: 'Research',
      html: frameHtml,
      sources: [],
      createdAt: '2026-10-06T10:00:00.000Z',
      pinned: false,
    }));
    render(<HtmlAppFrame
      artifactId="12345678-1234-4234-8234-123456789abc"
      title="Research"
      loadArtifact={loadArtifact}
      onOpenUrl={vi.fn()}
      onAsk={vi.fn()}
      onPinChange={vi.fn()}
      onResize={vi.fn()}
    />);
    const frame = await screen.findByTitle('Research');
    expect(loadArtifact).toHaveBeenCalledWith('12345678-1234-4234-8234-123456789abc', expect.any(AbortSignal));
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('srcdoc')).toContain(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'",
    );
    expect(frame.getAttribute('srcdoc')).toContain(frameHtml);
    expect(frame.hasAttribute('allow')).toBe(false);
    expect(frame.hasAttribute('allow-popups')).toBe(false);
  });

  it('accepts only exact, bounded messages from its own opaque-origin iframe', async () => {
    const onOpenUrl = vi.fn();
    const onAsk = vi.fn();
    const onPinChange = vi.fn(async () => {});
    const onResize = vi.fn();
    render(<HtmlAppFrame
      artifactId="12345678-1234-4234-8234-123456789abc"
      title="Research"
      loadArtifact={async () => ({
        id: '12345678-1234-4234-8234-123456789abc', kind: 'html', title: 'Research',
        html: '<p>Research</p>', sources: [], createdAt: '2026-10-06T10:00:00.000Z', pinned: false,
      })}
      onOpenUrl={onOpenUrl}
      onAsk={onAsk}
      onPinChange={onPinChange}
      onResize={onResize}
    />);
    const frame = await screen.findByTitle('Research') as HTMLIFrameElement;
    const message = (data: unknown, origin = 'null', source: MessageEventSource | null = frame.contentWindow) => {
      window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
    };

    message({ type: 'open_url', url: 'https://example.com/research' });
    message({ type: 'open_url', url: 'javascript:alert(1)' });
    message({ type: 'open_url', url: 'https://user@example.com' });
    message({ type: 'open_url', url: 'https://example.com', extra: true });
    message({ type: 'open_url', url: 'https://example.com' }, 'https://example.com');
    message({ type: 'open_url', url: 'https://example.com' }, 'null', window);
    message({ type: 'ask', text: 'Summarize this view' });
    message({ type: 'ask', text: 'x'.repeat(2_001) });
    message({ type: 'pin' });
    message({ type: 'unpin', extra: true });
    message({ type: 'resize', height: 480 });
    message({ type: 'resize', height: 2_001 });
    message({ type: 'run-script', code: 'alert(1)' });

    await waitFor(() => expect(onPinChange).toHaveBeenCalledWith(true));
    expect(onOpenUrl).toHaveBeenCalledTimes(1);
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com/research');
    expect(onAsk).toHaveBeenCalledOnce();
    expect(onAsk).toHaveBeenCalledWith('Summarize this view');
    expect(onPinChange).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledOnce();
    expect(onResize).toHaveBeenCalledWith(480);
  });
});
