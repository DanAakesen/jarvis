import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccountSettings } from './AccountSettings';

describe('account session controls', () => {
  it('shows the all-device action only for a stored owner session and confirms before calling it', async () => {
    const onSignOutAllDevices = vi.fn().mockResolvedValue(undefined);
    const view = render(<AccountSettings hasOwnerSession={false} signingOut={false}
      onSignOut={vi.fn()} onSignOutAllDevices={onSignOutAllDevices} />);
    expect(screen.queryByRole('button', { name: 'Sign out on all devices' })).toBeNull();

    view.rerender(<AccountSettings hasOwnerSession signingOut={false}
      onSignOut={vi.fn()} onSignOutAllDevices={onSignOutAllDevices} />);
    const trigger = screen.getByRole('button', { name: 'Sign out on all devices' });
    fireEvent.click(trigger);
    expect(screen.getByRole('group', { name: 'Confirm sign out on all devices' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSignOutAllDevices).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sign out on all devices' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out on all devices' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sign out on all devices' }));

    expect((await screen.findByRole('status')).textContent).toContain('All active devices have been signed out.');
    expect(onSignOutAllDevices).toHaveBeenCalledOnce();
  });

  it('keeps a recoverable confirmation and announces failures', async () => {
    const onSignOutAllDevices = vi.fn().mockRejectedValue(new Error('private backend response'));
    render(<AccountSettings hasOwnerSession signingOut={false}
      onSignOut={vi.fn()} onSignOutAllDevices={onSignOutAllDevices} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out on all devices' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sign out on all devices' }));

    expect((await screen.findByRole('alert')).textContent)
      .toContain('Could not sign out other devices. This device is still signed in.');
    expect(screen.getByRole('group', { name: 'Confirm sign out on all devices' })).toBeTruthy();
    expect(screen.queryByText('private backend response')).toBeNull();
    expect(onSignOutAllDevices).toHaveBeenCalledOnce();
  });
});
