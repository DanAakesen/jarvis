import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync('src/styles.css', 'utf8');

describe('header job control styling', () => {
  it('uses borderless shared control geometry rather than status-coloured tab boxes', () => {
    const tab = styles.match(/\.workspace-tab\s*\{([^}]+)\}/u)![1]!;
    expect(tab).toContain('border: 0;');
    expect(tab).toContain('border-radius: var(--radius-control);');
    expect(tab).not.toContain('backdrop-filter');
    const surface = styles.match(/\.workspace-tab-item, \.workspace-tab-item\[data-state\]\s*\{([^}]+)\}/u)![1]!;
    expect(surface).toContain('box-shadow: none;');
    expect(surface).toContain('border: 0;');
    expect(styles).not.toMatch(/\.job-tab\[data-tone="(?:running|failed|done)"\]\s*\{[^}]*box-shadow/u);
    expect(styles).toContain('.job-tabs :is(.workspace-tab, .workspace-tab-close):focus-visible { outline: 3px solid var(--focus);');
    expect(styles).toContain('.window-tabbar :is(.workspace-tab, .workspace-tab-close, .workspace-tab-pin):focus-visible { outline: 3px solid var(--focus);');
    expect(styles).toContain('.workspace-tab-item[data-state="front"]:hover { background: var(--state-selected-hover);');
    expect(styles).toContain('.workspace-tab-item[data-state="front"]:active { background: var(--state-selected-pressed);');
    expect(styles).toContain('.workspace-tab-pin[aria-pressed="true"]:hover { background: var(--state-selected-hover);');
    expect(styles).toContain('.workspace-tab-pin[aria-pressed="true"]:active { background: var(--state-selected-pressed);');
    expect(styles).toContain('.jobs-action-primary:is(:hover, :active):not(:disabled) { background: var(--primary-action-hover);');
    const selectedJob = styles.match(/\.job-tabs \.workspace-tab-item\[data-selected="true"\]\s*\{([^}]+)\}/u)![1]!;
    expect(selectedJob).toContain('--selection-hover: var(--state-selected-hover);');
    expect(selectedJob).toContain('--selection-pressed: var(--state-selected-pressed);');
  });

  it('keeps history scroll bounded and touch actions usable without adding an inner glass rim', () => {
    const popover = styles.match(/\.jobs-popover\s*\{([^}]+)\}/u)![1]!;
    expect(popover).toContain('overflow-y: auto;');
    expect(popover).toContain('max-height: min(560px, calc(100dvh - 120px));');
    expect(popover).toContain('border: 0;');
    expect(popover).toContain('background: var(--report-surface);');
    expect(styles).toContain('@media (pointer: coarse) { .jobs-action { min-height: 44px; } }');
    expect(styles).toContain('@media (max-width: 900px) { .app-shell[data-phone="false"] .job-tabs .jobs-popover { position: fixed; top: 64px; right: 12px; } }');
    expect(styles).toContain('.app-shell[data-phone="true"] .job-tabs .jobs-popover { position: static; width: 100%; max-height: min(400px, 45dvh); }');
    expect(styles).toContain('.jobs-history-entry:focus-visible { outline: 3px solid var(--focus);');
  });
});
