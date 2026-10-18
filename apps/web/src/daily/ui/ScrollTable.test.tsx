import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScrollTable } from './ScrollTable';

describe('ScrollTable', () => {
  it('provides a labelled keyboard-focusable region and optional sticky first column', () => {
    render(<ScrollTable label="Synthetic measurements" stickyFirstColumn><table><tbody><tr><th>Type</th><td>Whole word</td></tr></tbody></table></ScrollTable>);
    const region = screen.getByRole('region', { name: 'Synthetic measurements' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.className).toContain('daily-scroll-table-sticky');
    expect(screen.getByText('Whole word')).toBeTruthy();
  });
});
