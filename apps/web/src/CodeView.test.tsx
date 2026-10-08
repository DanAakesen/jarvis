import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CodeView } from './CodeView';

describe('CodeView', () => {
  it('shows numbered lines, highlights ranges, marks matches and links to GitHub', () => {
    render(<CodeView title="Reading backend" data={{
      repo: 'DanAakesen/jarvis', path: 'apps/backend/src/core/folio.ts', ref: 'main', language: 'typescript',
      content: 'const a = 1;\nexport function folio() {\n  return a;\n}', startLine: 10, highlight: [{ from: 11, to: 12 }], query: 'folio',
    }} />);
    expect(screen.getByText('folio.ts')).not.toBeNull();
    expect(document.querySelector('[data-line="10"]')?.hasAttribute('data-highlighted')).toBe(false);
    expect(document.querySelector('[data-line="11"]')?.hasAttribute('data-highlighted')).toBe(true);
    expect(document.querySelector('[data-line="12"]')?.hasAttribute('data-highlighted')).toBe(true);
    expect(document.querySelectorAll('mark.code-match')).toHaveLength(1);
    expect(screen.getByText(/Highlighted lines: 11 to 12\./)).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Open on GitHub' }).getAttribute('href'))
      .toBe('https://github.com/DanAakesen/jarvis/blob/main/apps/backend/src/core/folio.ts#L11-L12');
  });

  it('never links a repo that is not owner/name and renders markup as text', () => {
    render(<CodeView title="Reading" data={{ repo: 'local vault', path: 'Notes/a.md', content: '<img src=x onerror=alert(1)>' }} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).not.toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });
});