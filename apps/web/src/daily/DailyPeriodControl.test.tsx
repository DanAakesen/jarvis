import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
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

  it('keeps preset and custom dates labelled and operable in keyboard tab order', async () => {
    const user = userEvent.setup();
    const onPeriodChange = vi.fn();
    render(<DailyPeriodControl period={{ startDate: '2026-10-12', endDate: '2026-10-18' }} onPeriodChange={onPeriodChange} />);

    const preset = screen.getByRole('combobox', { name: 'Period' });
    preset.focus();
    await user.selectOptions(preset, 'custom');
    expect(document.activeElement).toBe(preset);

    const from = screen.getByLabelText('From');
    const to = screen.getByLabelText('To');
    await user.tab();
    expect(document.activeElement).toBe(from);
    await user.tab();
    expect(document.activeElement).toBe(to);
    fireEvent.change(from, { target: { value: '2026-10-10' } });
    fireEvent.change(to, { target: { value: '2026-10-17' } });
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Apply period' }));
    await user.keyboard('{Enter}');
    expect(onPeriodChange).toHaveBeenCalledWith({ startDate: '2026-10-10', endDate: '2026-10-17' });
  });
});
