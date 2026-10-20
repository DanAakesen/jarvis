import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DailyState } from './DailyState';

describe('DailyState', () => {
  it('announces loading, empty, partial and error states with the appropriate live roles', () => {
    const { rerender } = render(<DailyState status="loading" />);
    const loading = screen.getByRole('status');
    expect(loading.textContent).toContain('Loading Daily history');
    expect(loading.getAttribute('aria-live')).toBe('polite');

    rerender(<DailyState status="empty" emptyMessage="No synthetic records were returned." />);
    expect(screen.getByRole('status').textContent).toBe('No synthetic records were returned.');
    expect(screen.queryByRole('alert')).toBeNull();

    rerender(<DailyState status="partial" coverage={{ returned: 3, hasMore: true }} />);
    expect(screen.getByRole('status').textContent).toContain('Showing the first 3');
    expect(screen.getAllByRole('status')).toHaveLength(1);

    rerender(<DailyState status="error" message="Synthetic read failed." />);
    expect(screen.getByRole('alert').textContent).toContain('Synthetic read failed.');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a plain empty state', () => {
    render(<DailyState status="empty" />);
    expect(screen.getByRole('status').textContent).toBe('No records');
  });

  it('allows a loading announcement override without changing the shared presentation', () => {
    render(<DailyState status="loading" loadingLabel="Loading Health history" />);
    expect(screen.getByRole('status').textContent).toContain('Loading Health history');
    expect(screen.queryByText(/daily/iu)).toBeNull();
  });

  it('allows a specific empty-state sentence without changing the shared presentation', () => {
    render(<DailyState status="empty" emptyMessage="No meals recorded in the last 7 days" />);
    expect(screen.getByRole('status').textContent).toBe('No meals recorded in the last 7 days');
  });

  it('makes errors retryable and partial results loadable with freshness', () => {
    const retry = vi.fn();
    const loadMore = vi.fn();
    render(<DailyState status="error" onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();

    render(<DailyState status="partial" coverage={{ returned: 3, hasMore: true }} onLoadMore={loadMore}
      freshness={{ observedAt: '2026-10-17T07:00:00Z' }} />);
    expect(screen.getByText(/Showing the first 3/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(loadMore).toHaveBeenCalledOnce();
    expect(screen.getByText(/^Read /u)).toBeTruthy();
  });
});
