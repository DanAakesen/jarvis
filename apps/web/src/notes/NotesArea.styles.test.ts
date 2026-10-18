import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync('src/notes/NotesArea.css', 'utf8');

describe('mobile notes search styling', () => {
  it('prevents input focus zoom without disabling user zoom or changing graph zoom', () => {
    const mobile = styles.slice(styles.indexOf('@media (max-width: 700px)'));
    expect(mobile).toContain('.notes-page .knowledge-search input { font-size: 16px; }');
    expect(mobile).toContain('.notes-page .knowledge-search, .notes-page .knowledge-results { width: calc(100% - 16px); }');
    expect(styles).not.toMatch(/(?:touch-action:\s*none|zoom:|scale\()/u);
  });
});
