import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const { createAuthClient, restoreProfile, signIn } = vi.hoisted(() => ({
  createAuthClient: vi.fn(() => ({ initialize: vi.fn().mockResolvedValue(undefined) })),
  restoreProfile: vi.fn().mockResolvedValue(null),
  signIn: vi.fn(),
}));
vi.mock('./auth', () => ({ createAuthClient, restoreProfile, signIn }));

const config = { ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com' };

beforeEach(() => {
  vi.clearAllMocks();
  createAuthClient.mockReturnValue({ initialize: vi.fn().mockResolvedValue(undefined) });
  restoreProfile.mockResolvedValue(null);
});

describe('Jarvis routes', () => {
  it('disables sign-in until a backend is deployed', () => {
    render(<MemoryRouter><App config={{ ...__JARVIS_CONFIG__, backendUrl: null }} /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Jarvis is taking shape');
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toHaveProperty('disabled', true);
    expect(screen.getByText('Sign-in is unavailable until the backend is deployed.')).not.toBeNull();
  });

  it('shows Dan only after Microsoft sign-in and the backend profile request succeed', async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue({ name: 'Dan Aakesen' });
    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    const button = await screen.findByRole('button', { name: 'Sign in with Microsoft' });
    await user.click(button);

    expect(await screen.findByRole('heading', { name: 'Welcome, Dan Aakesen' })).not.toBeNull();
    expect(signIn).toHaveBeenCalledWith(expect.anything(), config);
  });

  it('shows the backend refusal and does not show a name for an unauthorized account', async () => {
    const user = userEvent.setup();
    signIn.mockRejectedValue(new Error("This Microsoft account isn't allowed to use Jarvis."));
    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: 'Sign in with Microsoft' }));

    expect((await screen.findByRole('alert')).textContent).toBe("This Microsoft account isn't allowed to use Jarvis.");
    expect(screen.queryByRole('heading', { name: /Welcome,/ })).toBeNull();
  });

  it('recovers from an unknown address through the home link', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/unknown/nested']}><App /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Page not found');
    await user.click(screen.getByRole('link', { name: 'Return to Jarvis' }));
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Jarvis is taking shape');
  });

  it('restores the verified name from an existing sign-in', async () => {
    restoreProfile.mockResolvedValue({ name: 'Dan Aakesen' });
    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Welcome, Dan Aakesen' })).not.toBeNull();
    expect(restoreProfile).toHaveBeenCalledWith(expect.anything(), config);
  });
});
