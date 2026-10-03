import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('Jarvis routes', () => {
  it('starts without sign-in or a deployed backend and does not claim to be connected', () => {
    render(<MemoryRouter><App config={{ ...__JARVIS_CONFIG__, backendUrl: null }} /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Jarvis is taking shape');
    expect(screen.getByText('Not available yet')).not.toBeNull();
    expect(screen.getByText('Waiting for the first deployment')).not.toBeNull();
  });

  it('recovers from an unknown address through the home link', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/unknown/nested']}><App /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Page not found');
    await user.click(screen.getByRole('link', { name: 'Return to Jarvis' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Jarvis is taking shape');
  });

  it('distinguishes an address from a verified backend connection', () => {
    render(<MemoryRouter><App config={{ ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com' }} /></MemoryRouter>);
    expect(screen.getByText('Address configured; connection has not been checked')).not.toBeNull();
    expect(screen.queryByText('Waiting for the first deployment')).toBeNull();
  });
});
