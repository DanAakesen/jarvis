import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { VaultMirrorStatus, VaultMirrorStatusView as VaultMirrorView } from '@jarvis/contracts';
import { VaultMirrorRow } from './VaultMirrorRow';

const now = Date.parse('2026-10-19T12:00:00Z');
function mirror(patch: Partial<VaultMirrorView> = {}): VaultMirrorView {
  return {
    state: 'healthy', lastSuccessAt: '2026-10-19T11:55:00Z', writeBack: 'dry-run',
    counts: { approved: 4, pushed: 1, writtenBack: 0, deleted: 0, conflicts: 1, skipped: 0,
      credentialMatches: 0, pendingWriteBack: 1, consecutiveFailures: 0 },
    conflictPaths: ['Notes/synthetic-conflict.md'],
    ...patch,
  };
}

describe('Vault mirror row', () => {
  it.each([
    ['not-set-up', 'Not set up'],
    ['healthy', 'Healthy'],
    ['stale', 'Stale'],
    ['needs-attention', 'Needs attention'],
    ['failed', 'Failed'],
    ['read-error', 'Read error'],
  ] as const)('shows %s quietly without mounting counts or paths', (state, phrase) => {
    render(<VaultMirrorRow value={mirror({ state })} now={now} />);
    expect(screen.getByText(phrase)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Vault mirror details' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Notes/synthetic-conflict.md')).toBeNull();
    expect(screen.queryByText('Approved')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows loading and read error when status is unavailable', () => {
    const view = render(<VaultMirrorRow loading now={now} />);
    expect(screen.getByText('Loading')).not.toBeNull();
    view.rerender(<VaultMirrorRow now={now} unavailable />);
    expect(screen.getByText('Read error')).not.toBeNull();
  });

  it('keeps dry-run visible, with relative success time and exact time on request', () => {
    render(<VaultMirrorRow value={mirror()} now={now} />);
    expect(screen.getByText('Dry-run')).not.toBeNull();
    expect(screen.getByText('Last success 5 min ago').getAttribute('datetime')).toBe('2026-10-19T11:55:00Z');
    const description = screen.getByRole('button', { name: 'Vault mirror details' }).getAttribute('aria-describedby');
    expect(description?.split(' ').map(id => document.getElementById(id)?.textContent).join(' ')).toBe('Healthy Dry-run Last success 5 min ago');
    expect(screen.queryByText(/not writing into Obsidian/)).toBeNull();
  });

  it('ages healthy status past thirty minutes without a new request', () => {
    const view = render(<VaultMirrorRow value={mirror()} now={now + 25 * 60_000} />);
    expect(screen.getByText('Healthy')).not.toBeNull();
    view.rerender(<VaultMirrorRow value={mirror()} now={now + 25 * 60_000 + 1} />);
    expect(screen.getByText('Stale')).not.toBeNull();
  });

  it('opens with Enter, closes with Space, retains focus and unmounts private paths', async () => {
    const user = userEvent.setup();
    render(<VaultMirrorRow value={mirror()} now={now} />);
    await user.tab();
    const button = screen.getByRole('button', { name: 'Vault mirror details' });
    expect(document.activeElement).toBe(button);
    await user.keyboard('{Enter}');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Notes/synthetic-conflict.md')).not.toBeNull();
    expect(screen.getByText('Approved')).not.toBeNull();
    expect(screen.getByText('Dry-run — not writing into Obsidian')).not.toBeNull();
    await user.keyboard(' ');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
    expect(screen.queryByText('Notes/synthetic-conflict.md')).toBeNull();
  });

  it.each([
    ['auth', 'Obsidian sign-in needs attention.'],
    ['policy-missing', 'The mirror policy is missing or invalid.'],
    ['repo-not-private', 'The vault repository is not private.'],
    ['pull-failed', 'The mirror could not download the latest notes.'],
    ['guard-tripped', 'The safety limits stopped this sync.'],
    ['conflict', 'Some notes have conflicting changes.'],
    ['secret-match', 'A credential check blocked some notes.'],
    ['push-rejected', 'GitHub rejected the mirror update.'],
    ['upload-failed', 'The mirror could not save its state.'],
    ['state-corrupt', 'The saved mirror state could not be read.'],
    ['timeout', 'The mirror run timed out.'],
    ['unexpected', 'The mirror run failed unexpectedly.'],
  ] satisfies [NonNullable<VaultMirrorStatus['reason']>, string][])('explains %s only on request', async (reason, sentence) => {
    const user = userEvent.setup();
    render(<VaultMirrorRow value={mirror({ state: 'needs-attention', reason })} now={now} />);
    expect(screen.queryByText(sentence)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Vault mirror details' }));
    expect(screen.getByText(sentence)).not.toBeNull();
  });

  it('never shows previous conflict paths after a failed refresh', async () => {
    const user = userEvent.setup();
    const view = render(<VaultMirrorRow value={mirror()} now={now} />);
    await user.click(screen.getByRole('button', { name: 'Vault mirror details' }));
    await act(async () => view.rerender(<VaultMirrorRow value={mirror()} unavailable now={now} />));
    expect(screen.queryByText('Notes/synthetic-conflict.md')).toBeNull();
    expect(screen.getByText(/Use Refresh status/)).not.toBeNull();
  });
});
