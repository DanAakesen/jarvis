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
    expect(livePhraseFor('working', 'daily_query')).toBe('Checking your health data…');
    expect(livePhraseFor('working', 'calendar_list_events')).toBe('Checking your calendar…');
    expect(livePhraseFor('working', 'create_task')).toBe('Working on your tasks…');
  });

  it('falls back to a plain line for unknown or missing tools', () => {
    expect(livePhraseFor('working', 'something_new')).toBe('Working on it…');
    expect(livePhraseFor('working', null)).toBe('Working on it…');
  });
});
