import { render, screen } from '@testing-library/react';
import { ToolCallChip } from './ToolCallChip';
import { describe, expect, it } from 'vitest';
import { livePhraseFor } from './live-phrase';

describe('livePhraseFor', () => {
  it('uses one steady line for thinking and composing', () => {
    expect(livePhraseFor('thinking')).toBe('Thinking…');
    expect(livePhraseFor('composing', 'vault_search')).toBe('Writing it up…');
  });

  it('names what the running tool is doing', () => {
    expect(livePhraseFor('working', 'vault_search')).toBe('Searching your notes…');
    expect(livePhraseFor('working', 'workspaces_search')).toBe('Searching your notes…');
    expect(livePhraseFor('working', 'vault_write')).toBe('Updating your notes…');
    expect(livePhraseFor('working', 'health_query')).toBe('Checking your health data…');
    expect(livePhraseFor('working', 'calendar_list_events')).toBe('Checking your calendar…');
    expect(livePhraseFor('working', 'create_task')).toBe('Working on your tasks…');
  });

  it('falls back to a plain line for unknown or missing tools', () => {
    expect(livePhraseFor('working', 'something_new')).toBe('Working on it…');
    expect(livePhraseFor('working', null)).toBe('Working on it…');
  });
});

it.each(['health_food_review', 'daily_food_review'])('brands current and retained %s tool chips as Health', tool => {
  const view = render(<ToolCallChip tool={tool} state="ok" />);
  expect(screen.getByText('Health food review')).toBeTruthy();
  expect(view.container.textContent).not.toContain('Daily');
  view.unmount();
});

it.each([['daily_health_history', 'Health history'], ['daily_health_summary', 'Health summary']])(
  'keeps retained %s branding readable', (tool, label) => {
    const view = render(<ToolCallChip tool={tool} state="ok" />);
    expect(screen.getByText(label)).toBeTruthy();
    view.unmount();
  },
);
