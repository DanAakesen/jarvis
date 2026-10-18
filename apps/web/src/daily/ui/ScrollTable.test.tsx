import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScrollTable } from './ScrollTable';

describe('ScrollTable', () => {
  it('provides a labelled keyboard-focusable region and optional sticky first column', () => {
    render(<ScrollTable label="Synthetic measurements" stickyFirstColumn>
      <table><caption>Recorded synthetic measurements</caption>
        <thead><tr><th scope="col">Type</th><th scope="col">Value</th></tr></thead>
        <tbody><tr><th scope="row">Whole word</th><td>Recorded value</td></tr></tbody>
      </table>
    </ScrollTable>);
    const region = screen.getByRole('region', { name: 'Synthetic measurements' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.className).toContain('daily-scroll-table-sticky');
    const table = screen.getByRole('table', { name: 'Recorded synthetic measurements' });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
    expect(within(table).getByRole('rowheader', { name: 'Whole word' })).toBeTruthy();
    expect(within(table).getByRole('cell', { name: 'Recorded value' })).toBeTruthy();
  });
});
