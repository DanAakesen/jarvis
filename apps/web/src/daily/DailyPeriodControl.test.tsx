import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DailyPeriodControl } from './DailyPeriodControl';

describe('DailyPeriodControl', () => {
  it('opens custom dates from a selected preset', () => {
    render(<DailyPeriodControl period={{ startDate: '2026-10-12', endDate: '2026-10-18' }} onPeriodChange={() => {}} />);
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'custom' } });
    expect(screen.getByLabelText('From')).toBeTruthy();
    expect(screen.getByLabelText('To')).toBeTruthy();
  });

  it('updates shared presets and rejects an invalid custom range without applying it', () => {
    const onPeriodChange = vi.fn();
    render(<DailyPeriodControl period={{ startDate: '2026-10-12', endDate: '2026-10-18' }} onPeriodChange={onPeriodChange} />);
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '90' } });
    expect(onPeriodChange).toHaveBeenCalledOnce();

    cleanup();
    render(<DailyPeriodControl period={{ startDate: '2026-10-01', endDate: '2026-10-18' }} onPeriodChange={onPeriodChange} />);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-19' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply period' }));
    expect(screen.getByRole('alert').textContent).toContain('no more than 366 days');
    expect(onPeriodChange).toHaveBeenCalledOnce();
  });
});
