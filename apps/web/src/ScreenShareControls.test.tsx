import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScreenShareControls } from './ScreenShareControls';
import type { ScreenShareController } from './screen-sharing';

describe('ScreenShareControls', () => {
  it('shows a start control, then a persistent sharing indicator and stop control', async () => {
    const start = vi.fn(async () => {});
    const stop = vi.fn();
    const controller: ScreenShareController = {
      sharing: false, error: '', start, stop, inspect: async () => 'description',
    };
    const user = userEvent.setup();
    const view = render(<ScreenShareControls screenShare={controller} />);

    await user.click(screen.getByRole('button', { name: 'Share screen' }));
    expect(start).toHaveBeenCalledOnce();

    view.rerender(<ScreenShareControls screenShare={{ ...controller, sharing: true }} />);
    expect(screen.getByRole('status').textContent).toContain('only inspects a frame when you ask');
    await user.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(stop).toHaveBeenCalledOnce();
  });
});
