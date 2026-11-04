import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HealthState } from './HealthState';

describe('HealthState', () => {
  it('announces loading, empty, partial and error states with the appropriate live roles', () => {
    const { rerender } = render(<HealthState status="loading" />);
    const loading = screen.getByRole('status');
    expect(loading.textContent).toContain('Loading Health history');
    expect(loading.getAttribute('aria-live')).toBe('polite');

    rerender(<HealthState status="empty" emptyMessage="No synthetic records were returned." />);
    expect(screen.getByRole('status').textContent).toBe('No synthetic records were returned.');
    expect(screen.queryByRole('alert')).toBeNull();

    rerender(<HealthState status="partial" coverage={{ returned: 3, hasMore: true }} />);
    expect(screen.getByRole('status').textContent).toContain('Showing the first 3');
    expect(screen.getAllByRole('status')).toHaveLength(1);

    rerender(<HealthState status="error" message="Synthetic read failed." />);
    expect(screen.getByRole('alert').textContent).toContain('Synthetic read failed.');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a plain empty state', () => {
    render(<HealthState status="empty" />);
    expect(screen.getByRole('status').textContent).toBe('No records');
  });

  it('allows a loading announcement override without changing the shared presentation', () => {
    render(<HealthState status="loading" loadingLabel="Loading Health history" />);
    expect(screen.getByRole('status').textContent).toContain('Loading Health history');
    expect(screen.queryByText(/daily/iu)).toBeNull();
  });

  it('allows a specific empty-state sentence without changing the shared presentation', () => {
    render(<HealthState status="empty" emptyMessage="No meals recorded in the last 7 days" />);
    expect(screen.getByRole('status').textContent).toBe('No meals recorded in the last 7 days');
  });

  it('makes errors retryable and partial results loadable with freshness', () => {
    const retry = vi.fn();
    const loadMore = vi.fn();
    render(<HealthState status="error" onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();

    render(<HealthState status="partial" coverage={{ returned: 3, hasMore: true }} onLoadMore={loadMore}
      freshness={{ observedAt: '2026-10-17T07:00:00Z' }} />);
    expect(screen.getByText(/Showing the first 3/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(loadMore).toHaveBeenCalledOnce();
    expect(screen.getByText(/^Read /u)).toBeTruthy();
  });
});
