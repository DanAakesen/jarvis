import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DailyState } from './DailyState';

describe('DailyState', () => {
  it('shows the shared loading state', () => {
    render(<DailyState status="loading" />);
    expect(screen.getByText('Loading Daily history')).toBeTruthy();
  });

  it('explains empty history without claiming the original source is empty', () => {
    render(<DailyState status="empty" />);
    expect(screen.getByText(/History appears after an import or a phone upload/u)).toBeTruthy();
    expect(screen.getByText(/None returned does not prove the original source is empty/u)).toBeTruthy();
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
