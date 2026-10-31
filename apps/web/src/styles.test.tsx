import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Color = [number, number, number];

// Daily has parallel responsive work and remains outside this pass's breakpoint contract.
function stylesheetFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'daily' ? [] : stylesheetFiles(path);
    return entry.name.endsWith('.css') ? [path] : [];
  });
}

const stylesheets = stylesheetFiles('src').map((path) => readFileSync(path, 'utf8'));
const sharedStyles = readFileSync('src/styles.css', 'utf8');

function mediaBlocks(source: string): Array<{ query: string; body: string }> {
  const blocks: Array<{ query: string; body: string }> = [];
  const media = /@media\s*([^{}]+)\{/g;
  let match: RegExpExecArray | null;
  while ((match = media.exec(source))) {
    let depth = 1;
    let end = media.lastIndex;
    for (; end < source.length && depth > 0; end += 1) {
      if (source[end] === '{') depth += 1;
      else if (source[end] === '}') depth -= 1;
    }
    blocks.push({ query: match[1]!, body: source.slice(media.lastIndex, end - 1) });
    media.lastIndex = end;
  }
  return blocks;
}

describe('responsive stylesheet contract', () => {
  it('does not force document overflow below the narrow-phone width at high zoom', () => {
    expect(ruleDeclaration(sharedStyles, /(?:^|\n)body\s*\{([^}]*)\}/, 'min-width')).toBe('min(280px, 100%)');
  });

  it('uses only the canonical viewport breakpoints and documented narrow-phone exception', () => {
    const values = new Set<number>();
    for (const source of stylesheets) {
      for (const { query } of mediaBlocks(source)) {
        for (const match of query.matchAll(/(?:min|max)-width\s*:\s*(\d+(?:\.\d+)?)px|\bwidth\s*(?:<=|>=|<|>)\s*(\d+(?:\.\d+)?)px/g)) {
          values.add(Number(match[1] ?? match[2]));
        }
      }
    }
    expect([...values].sort((a, b) => a - b)).toEqual([380, 700, 900, 1200]);
  });

  it('pairs every full-height 100vh declaration with a dynamic viewport declaration', () => {
    for (const source of stylesheets) {
      for (const [, rule] of source.matchAll(/[^{}]*\{([^{}]*)\}/gs)) {
        if (!/(?:^|;)\s*(?:min-|max-)?height\s*:[^;]*100vh\b/.test(rule!)) continue;
        expect(rule).toMatch(/(?:^|;)\s*(?:min-|max-)?height\s*:[^;]*100dvh\b/);
      }
    }
    expect(sharedStyles).toContain('.app { min-height: 100vh; min-height: 100dvh; }');
  });

  it('uses shrinkable tracks in fixed-column phone grids', () => {
    for (const source of stylesheets) {
      for (const { query, body } of mediaBlocks(source)) {
        if (!/max-width:\s*700px|max-height:\s*500px/.test(query)) continue;
        for (const match of body.matchAll(/grid-template-columns\s*:\s*repeat\(\s*\d+\s*,\s*([^;]+)\)/g)) {
          expect(match[0]!.replace(/\s+/g, '')).toMatch(/^grid-template-columns:repeat\(\d+,minmax\(0,1fr\)\)$/);
        }
      }
    }
    expect(sharedStyles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
  });

  it('keeps the phone page sheet compact above the composer and navigation dock', () => {
    expect(sharedStyles).toContain('bottom: calc(var(--phone-dock-bottom, 84px) + var(--conversation-composer-height, 52px) + var(--space-2));');
    expect(sharedStyles).toContain('inset: 0 0 calc(var(--phone-dock-bottom, 84px) + var(--conversation-composer-height, 52px) + var(--space-2));');
    expect(sharedStyles).toContain('.mobile-menu { position: fixed; z-index: var(--z-sheet); inset: 0; pointer-events: none; }');
    expect(sharedStyles).toContain('animation: mobile-sheet-in 380ms var(--ease-enter) both; pointer-events: auto;');
    expect(sharedStyles).toContain('max-height: min(196px, calc(var(--overlay-viewport-height, 100dvh) - var(--phone-dock-bottom, 84px) - var(--conversation-composer-height, 52px) - env(safe-area-inset-top) - var(--space-4)));');
    expect(sharedStyles).toContain('.mobile-menu-page .mobile-menu-link { grid-template-columns: 20px minmax(0, 1fr) 12px; min-height: 48px; gap: var(--space-1); padding-inline: var(--space-1); font-size: var(--type-small); }');
    expect(sharedStyles).toContain('.mobile-menu-backdrop { animation-duration: var(--motion-state); backdrop-filter: none; }');
    expect(sharedStyles).toContain('.mobile-menu-sheet .mobile-menu-body { flex: 1 1 auto; }');
  });

  it('uses the phone conversation canvas without the desktop window frame', () => {
    const history = readFileSync('src/ConversationHistory.css', 'utf8');
    expect(history).toContain('.app-shell[data-phone="true"][data-voice-active="false"] .workspace[data-phone="true"] .workspace-window-conversation:not([hidden], .workspace-window-minimized)');
    expect(history).toContain('align-self: stretch; flex: 1 1 auto; width: 100%; height: auto; max-height: none; min-height: 0;');
    expect(history).toContain('.app-shell[data-phone="true"][data-voice-active="false"] .workspace-window-conversation .workspace-window-heading { display: none; }');
    expect(history).toContain('padding: var(--space-3); -webkit-mask-image: none; mask-image: none;');
  });

  it('keeps a growing shared message row and external feedback', () => {
    const history = readFileSync('src/ConversationHistory.css', 'utf8');
    expect(history).toContain('.app-shell .conversation-history .composer textarea { max-height: 160px; overflow-y: auto; }');
    expect(history).toContain('.composer-feedback > .composer-status { margin: 0 0 var(--space-2); padding: var(--space-2); border-radius: var(--radius-control); background: var(--surface-translucent); }');
  });

  it('keeps table scrolling focusable and the narrow action grid shrinkable', () => {
    expect(ruleDeclaration(sharedStyles, /\.generated-view-table:focus-visible\s*\{([^}]*)\}/, 'outline'))
      .toBe('3px solid var(--focus)');
    expect(ruleDeclaration(readFileSync('src/ConversationHistory.css', 'utf8'),
      /\.conversation-history \.composer textarea\s*\{([^}]*)\}/, 'min-height')).toBe('44px');
    expect(ruleDeclaration(sharedStyles, /\.usage-rank-label a\s*\{([^}]*)\}/, 'display')).toBe('block');
    expect(ruleDeclaration(sharedStyles, /\.usage-rank-label a\s*\{([^}]*)\}/, 'max-width')).toBe('100%');
    expect(ruleDeclaration(sharedStyles, /\.release-page h2\s*\{([^}]*)\}/, 'overflow-wrap')).toBe('anywhere');
    expect(ruleDeclaration(sharedStyles, /\.release-trail-pipeline li\s*\{([^}]*)\}/, 'min-width')).toBe('0');
    expect(ruleDeclaration(sharedStyles, /\.release-trail-pipeline a\s*\{([^}]*)\}/, 'overflow-wrap')).toBe('anywhere');
    expect(sharedStyles).toContain('.kanban-strip-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(sharedStyles).toContain('.deployment-add { grid-template-columns: repeat(2, minmax(0, 1fr)); }');
  });

  it('keeps the Dictate icon visible on narrow phones', () => {
    const historyStyles = readFileSync('src/ConversationHistory.css', 'utf8');
    const narrowRules = mediaBlocks(historyStyles).find(({ query }) => query.includes('max-width: 380px'))?.body ?? '';
    expect(narrowRules).not.toContain('.composer-dictate svg { display: none; }');

  });
});

describe('app-wide control contract', () => {
  const source = sharedStyles;

  it('preserves the field lines in Now confirmation summaries and wraps long values', () => {
    expect(ruleDeclaration(source, /\.confirmation-summary\s*\{([^}]*)\}/, 'white-space')).toBe('pre-line');
    expect(ruleDeclaration(source, /\.confirmation-summary\s*\{([^}]*)\}/, 'overflow-wrap')).toBe('anywhere');
  });

  it.each([
    'settings-back', 'signin-button',
    'presence-chip-trigger', 'presence-option', 'presence-mode-card',
    'memory-item', 'modal-close', 'knowledge-reset', 'workspaces-search', 'workspaces-kind',
    'workspaces-action', 'mobile-menu-link', 'kanban-filter-toggle', 'kanban-column-toggle',
    'collapsible-toggle', 'usage-segmented', 'advanced-segmented',
  ])('uses the existing action geometry for .%s', (name) => {
    expect(ruleDeclaration(source, new RegExp(`(?:^|\\n)\\.${name}\\s*\\{([^}]*)\\}`), 'border-radius'))
      .toBe('var(--radius-control)');
  });

  it('keeps shared button variants on one margin-free, focusable control system', () => {
    const sharedButtonRule = /\.primary-button, \.secondary-button, \.ghost-button, \.danger-button\s*\{([^}]*)\}/;
    expect(ruleDeclaration(source, sharedButtonRule, 'min-height')).toBe('44px');
    expect(ruleDeclaration(source, sharedButtonRule, 'border-radius')).toBe('var(--radius-control)');
    const buttonStyles = [
      source,
      readFileSync('src/proactive.css', 'utf8'),
      readFileSync('src/PushNotifications.css', 'utf8'),
      readFileSync('src/ConversationHistory.css', 'utf8'),
      readFileSync('src/notes/NotesArea.css', 'utf8'),
    ];
    for (const styles of buttonStyles) {
      const buttonRules = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, selectors]) => /\.((primary|secondary|ghost|danger)-button|settings-back|jobs-action|workspace-control|workspace-icon-control|workspace-tab-close|workspace-tab-pin|modal-close|workspaces-action|release-trail-button|release-trail-open|proactive-text-toggle|history-button)(?![\w-])/.test(selectors!));
      for (const [, selectors, declarations] of buttonRules) {
        expect(declarations, selectors).not.toMatch(/(?:^|;)\s*margin(?:-[a-z-]+)?\s*:/);
        expect(declarations, selectors).not.toMatch(/box-shadow:\s*[^;]*(?:inset|glass-selected-glow)/);
        if (!selectors!.includes(':focus-visible')) expect(declarations, selectors).not.toMatch(/outline\s*:/);
      }
    }
    expect(source).toContain('.primary-button:focus-visible');
    expect(source).toContain('.secondary-button:focus-visible');
    expect(source).toContain('.ghost-button:focus-visible');
    expect(source).toContain('.danger-button--filled:focus-visible');
    expect(source).toContain('.workspace-tab-close:focus-visible, .workspace-tab-pin:focus-visible');
    expect(source).toContain('.primary-button[aria-busy="true"] > .button-label');
    expect(source).toContain('.primary-button[aria-busy="true"] > .button-loading-indicator');
    expect(ruleDeclaration(source, /\.button-loading-indicator\s*\{([^}]*)\}/, 'position')).toBe('absolute');
    expect(source).toContain('@media (pointer: coarse) {\n  :is(.primary-button, .secondary-button, .ghost-button, .danger-button, .settings-back,');
    expect(source).toContain('button-primary-shadow');
  });

  it('provides wrapping action groups with consistent responsive button targets', () => {
    expect(source).toContain('.button-group, .settings-actions, .task-dialog-actions, .action-row');
    expect(source).toContain('.button-group > :is(button, a), .settings-actions > :is(button, a), .task-dialog-actions > :is(button, a),');
    expect(source).toContain('.workspace-view-content .task-window-actions, .workspace-view-content .timeline-artifacts { padding-top: var(--space-3); }');
    expect(source).toContain('@media (max-width: 700px) {\n  .button-group, .settings-actions, .task-dialog-actions, .settings-save');
    expect(source).toContain('width: 100%; max-width: 100%;');
  });

  it('keeps generated content within its window and localizes intentional horizontal scrolling', () => {
    expect(ruleDeclaration(sharedStyles, /\.workspace-view-content\s*\{([^}]*)\}/, 'min-width')).toBe('0');
    expect(ruleDeclaration(sharedStyles, /\.code-view\s*\{([^}]*)\}/, 'max-width')).toBe('100%');
    expect(ruleDeclaration(sharedStyles, /\.code-view-path\s*\{([^}]*)\}/, 'overflow-wrap')).toBe('anywhere');
    expect(ruleDeclaration(sharedStyles, /\.code-view-body\s*\{([^}]*)\}/, 'min-width')).toBe('0');
    expect(ruleDeclaration(sharedStyles, /\.code-view--wrap \.code-view-body code\s*\{([^}]*)\}/, 'min-width')).toBe('0');
    expect(ruleDeclaration(sharedStyles, /\.code-view--wrap \.code-line-text\s*\{([^}]*)\}/, 'overflow-wrap')).toBe('anywhere');
    expect(ruleDeclaration(sharedStyles, /\.generated-view-table\s*\{([^}]*)\}/, 'overflow')).toBe('auto');
    expect(ruleDeclaration(sharedStyles, /\.generated-view-details\s*\{([^}]*)\}/, 'grid-template-columns'))
      .toBe('minmax(5rem, 12rem) minmax(0, 1fr)');
    expect(ruleDeclaration(sharedStyles, /\.workspace-view-content \.activity-meta\s*\{([^}]*)\}/, 'grid-template-columns'))
      .toBe('minmax(0, 35%) minmax(0, 1fr)');
    expect(ruleDeclaration(sharedStyles, /\.generated-view-images img\s*\{([^}]*)\}/, 'height')).toBe('auto');
    expect(ruleDeclaration(sharedStyles, /\.generated-chart-plot\s*\{([^}]*)\}/, 'overflow-x')).toBe('auto');
    expect(ruleDeclaration(sharedStyles, /\.generated-chart-plot:focus-visible\s*\{([^}]*)\}/, 'outline'))
      .toBe('3px solid var(--focus)');
    expect(ruleDeclaration(sharedStyles, /\.html-app-frame\s*\{([^}]*)\}/, 'max-width')).toBe('100%');
  });

  it('keeps Daily phone navigation, detail spacing, focus and reduced motion consistent', () => {
    const nutrition = readFileSync('src/daily/sections/nutrition/nutrition.css', 'utf8');
    const workouts = readFileSync('src/daily/sections/workouts/workouts.css', 'utf8');
    const overview = readFileSync('src/daily/daily-overview.css', 'utf8');
    const shared = readFileSync('src/daily/ui/daily-ui.css', 'utf8');
    expect(ruleDeclaration(nutrition, /\.nutrition-controls\s*\{([^}]*)\}/, 'display')).toBe('flex');
    expect(ruleDeclaration(nutrition, /\.nutrition-controls\s*\{([^}]*)\}/, 'flex-wrap')).toBe('wrap');
    expect(ruleDeclaration(nutrition, /\.nutrition-controls\s*\{([^}]*)\}/, 'align-items')).toBe('flex-end');
    expect(ruleDeclaration(nutrition, /\.nutrition-controls label\s*\{([^}]*)\}/, 'min-width')).toBe('0');
    expect(ruleDeclaration(nutrition, /\.nutrition-weekly-list dl > div\s*\{([^}]*)\}/, 'grid-template-columns'))
      .toBe('max-content minmax(0, 1fr)');
    expect(nutrition).toContain('min-height: 44px');
    expect(ruleDeclaration(workouts, /\.workouts-detail\s*>\s*h3\s*\{([^}]*)\}/, 'margin')).toBe('0');
    expect(overview).toContain('@media (prefers-reduced-motion: reduce)');
    expect(overview).toContain('@media (min-width: 700px)');
    expect(overview).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(overview).toContain('@media (min-width: 1200px)');
    expect(overview).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(shared).toContain('.daily-coverage-note > summary:focus-visible');
    expect(shared).toContain('min-height: 44px; align-content: center; cursor: pointer');
  });

  it('does not leave production buttons without a shared class', () => {
    const unstyled: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.isFile() && entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
          const content = readFileSync(path, 'utf8');
          for (const [tag] of content.matchAll(/<button\b[^>]*>/gs)) {
            if (!/\bclassName\s*=/.test(tag)) unstyled.push(`${path}: ${tag}`);
          }
        }
      }
    };
    visit('src');
    expect(unstyled).toEqual([]);
  });

  it('keeps navigation options and form fields on the same geometry, not capsules', () => {
    for (const selector of [
      /\.usage-segmented button\s*\{([^}]*)\}/,
      /\.advanced-segmented button\s*\{([^}]*)\}/,
      /\.settings-field select, \.settings-field input, \.settings-field textarea\s*\{([^}]*)\}/,
      /\.timeline-toolbar select\s*\{([^}]*)\}/,
      /\.usage-field select\s*\{([^}]*)\}/,
      /\.release-trail-button, \.release-trail-open\s*\{([^}]*)\}/,
    ]) {
      expect(ruleDeclaration(source, selector, 'border-radius')).toBe('var(--radius-control)');
    }
    for (const file of ['ChatAttachments.css', 'notes/NotesArea.css']) {
      const css = readFileSync(`src/${file}`, 'utf8');
      const selector = file === 'ChatAttachments.css'
        ? /\.attachment-remove\s*\{([^}]*)\}/
        : /\.notes-page \.knowledge-search \.notes-create-button\s*\{([^}]*)\}/;
      expect(ruleDeclaration(css, selector, 'border-radius')).toBe('var(--radius-control)');
    }
  });

  it('uses shared panel surfaces and form-field backgrounds in Settings', () => {
    const settingsSection = /\.settings-section\s*\{\n\s*position:[^;]+;([^}]*)\}/;
    expect(ruleDeclaration(source, settingsSection, 'border')).toBe('1px solid var(--rule)');
    expect(ruleDeclaration(source, settingsSection, 'border-radius')).toBe('var(--radius-panel)');
    expect(ruleDeclaration(source, settingsSection, 'background')).toBe('var(--surface-translucent)');
    const popover = /\.jobs-popover\s*\{([^}]*)\}/;
    expect(ruleDeclaration(source, popover, 'border')).toBe('1px solid var(--rule)');
    expect(ruleDeclaration(source, popover, 'border-radius')).toBe('var(--radius-panel)');
    expect(ruleDeclaration(source, popover, 'background')).toBe('var(--surface)');
    expect(ruleDeclaration(source,
      /\.settings-field select, \.settings-field input, \.settings-field textarea\s*\{\n\s*border-color:[^;]+;([^}]*)\}/,
      'background-color')).toBe('var(--surface)');
    expect(ruleDeclaration(source, /\.settings-save\s*\{\n\s*position:[^;]+;([^}]*)\}/, 'border-radius'))
      .toBe('var(--radius-panel)');
  });

  it('surfaces release headers and gives release links touch targets on coarse pointers', () => {
    const header = /\.release-page-header\s*\{([^}]*)\}/;
    expect(ruleDeclaration(source, header, 'padding')).toBe('var(--space-4) var(--space-5)');
    expect(ruleDeclaration(source, header, 'border')).toBe('1px solid var(--rule)');
    expect(ruleDeclaration(source, header, 'border-radius')).toBe('var(--radius-panel)');
    expect(ruleDeclaration(source, header, 'background')).toBe('var(--surface-translucent)');
    const coarseReleaseLinks = mediaBlocks(source).find(({ query, body }) =>
      query.includes('pointer: coarse') && body.includes('.release-trail-pipeline a'));
    expect(coarseReleaseLinks).toBeDefined();
    const touchTargets = /\.release-trail-name a, \.release-trail-pipeline a, \.release-record-title > a\s*\{([^}]*)\}/;
    expect(ruleDeclaration(coarseReleaseLinks!.body, touchTargets, 'display')).toBe('inline-flex');
    expect(ruleDeclaration(coarseReleaseLinks!.body, touchTargets, 'min-height')).toBe('44px');
    expect(ruleDeclaration(coarseReleaseLinks!.body, touchTargets, 'align-items')).toBe('center');
    expect(ruleDeclaration(source, /\.release-record-title > a\s*\{([^}]*)\}/, 'overflow-wrap')).toBe('anywhere');
  });

  it('uses touch-sized advanced Settings controls and content-width push actions', () => {
    const coarse = mediaBlocks(source).find(({ query, body }) =>
      query.trim() === '(pointer: coarse)' && body.includes('.settings-field.advanced-range'))?.body ?? '';
    expect(coarse).toContain('.settings-field.advanced-range input[type="range"] { height: 44px; min-height: 44px; }');
    expect(coarse).toContain('.advanced-colour input[type="color"] { width: 44px; height: 44px; }');
    const pushNotifications = readFileSync('src/PushNotifications.css', 'utf8');
    expect(ruleDeclaration(pushNotifications, /\.push-notifications\s*\{([^}]*)\}/, 'justify-items')).toBe('start');
  });

  it('pairs Daily and Proactive block alerts with the shared error surface', () => {
    const daily = readFileSync('src/daily/daily.css', 'utf8');
    const proactive = readFileSync('src/proactive.css', 'utf8');
    const shared = readFileSync('src/styles.css', 'utf8');
    expect(ruleDeclaration(daily, /\.daily-notice\[role="alert"\]\s*\{([^}]*)\}/, 'background'))
      .toBe('var(--error-surface)');
    expect(ruleDeclaration(daily, /\.daily-notice\[role="alert"\]\s*\{([^}]*)\}/, 'border')).toBe('1px solid var(--rule)');
    expect(proactive).toContain('.proactive-page [role="alert"]');
    expect(ruleDeclaration(shared, /\.state-message--error\s*\{([^}]*)\}/, 'background')).toBe('var(--error-surface)');
    expect(ruleDeclaration(shared, /\.state-message--error\s*\{([^}]*)\}/, 'border')).toBe('1px solid var(--rule)');
  });

  it('gives empty and loading state messages the error surface and keeps them flat inside surfaced containers', () => {
    const defaults = /(?:^|\n):where\(\.state-message--empty, \.state-message--loading\)\s*\{([^}]*)\}/;
    expect(ruleDeclaration(sharedStyles, defaults, 'padding-inline')).toBe('var(--space-3)');
    expect(ruleDeclaration(sharedStyles, defaults, 'border')).toBe('1px solid var(--rule)');
    expect(ruleDeclaration(sharedStyles, defaults, 'border-radius')).toBe('var(--radius-panel)');
    expect(ruleDeclaration(sharedStyles, defaults, 'background')).toBe('var(--surface-translucent)');
    // The error colour stays with the error variant; zero specificity lets a component's own surface win.
    expect(sharedStyles.match(defaults)?.[1]).not.toMatch(/(?:^|[;\s])color:/u);
    expect(sharedStyles).not.toMatch(/:where\([^)]*state-message--(?:error|partial)/u);

    const reset = sharedStyles.match(
      /(?:^|\n):where\(([^)]*)\)\s*:where\(\.state-message--empty, \.state-message--loading\)\s*\{([^}]*)\}/);
    expect(reset).not.toBeNull();
    const containers = (reset?.[1] ?? '').split(',').map((name) => name.trim()).filter(Boolean);
    expect(containers).toEqual(expect.arrayContaining([
      '.settings-section', '.workspace-window', '.workspaces-pane', '.release-section', '.release-trail', '.task-release-bar',
      '.task-card', '.memory-detail', '.conversation-message', '.context-panel', '.knowledge-note', '.proactive-page',
      '.kanban-column', '.task-column', '.modal', '.project-dialog-part', '.jobs-popover',
    ]));
    expect(reset?.[2]).toMatch(/padding-inline:\s*0;/u);
    expect(reset?.[2]).toMatch(/border:\s*0;/u);
    expect(reset?.[2]).toMatch(/background:\s*none;/u);
    // Both rules have zero specificity, so the reset only wins by coming later.
    expect(sharedStyles.indexOf(reset?.[0] ?? '')).toBeGreaterThan(sharedStyles.search(defaults));
    // A container that no stylesheet defines would silently never flatten its messages.
    const elsewhere = stylesheets.join('\n').replace(reset?.[0] ?? '', '');
    for (const name of containers) {
      expect(elsewhere, name).toMatch(new RegExp(`${name.replaceAll('.', '\\.')}(?![\\w-])`, 'u'));
    }
  });

  it('shows the knowledge graph loader as a text-free constellation and its messages as a compact centred card', () => {
    const card = sharedStyles.match(/\n\.knowledge-status\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(card).toMatch(/(?:^|[;\s])position:\s*absolute;/u);
    expect(card).toMatch(/(?:^|[;\s])width:\s*max-content;/u);
    expect(card).toMatch(/(?:^|[;\s])max-width:\s*min\(420px, 90%\);/u);
    const loader = sharedStyles.match(/\n\.knowledge-loader\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(loader).toMatch(/(?:^|[;\s])width:\s*96px;/u);
    expect(loader).not.toMatch(/background|border|padding|inset/u);
    expect(sharedStyles).toContain('@media (prefers-reduced-motion: reduce) { .knowledge-loader circle { animation: none; } }');
    expect(sharedStyles).toContain(':root[data-motion="reduced"] .knowledge-loader circle { animation: none; }');
  });

  it('puts the Proactive page, Usage range switch, Status intro and 404 page on readable surfaces', () => {
    const proactive = readFileSync('src/proactive.css', 'utf8');
    const page = /\.proactive-page\s*\{([^}]*)\}/;
    expect(ruleDeclaration(proactive, page, 'background')).toBe('var(--surface-translucent)');
    expect(ruleDeclaration(proactive, page, 'border')).toBe('1px solid var(--rule)');
    expect(ruleDeclaration(proactive, page, 'border-radius')).toBe('var(--radius-panel)');
    const phone = mediaBlocks(proactive).find(({ query }) => /max-width:\s*700px/.test(query));
    expect(ruleDeclaration(phone?.body ?? '', /\.proactive-page\s*\{([^}]*)\}/, 'margin-bottom'))
      .toBe('max(160px, calc(env(safe-area-inset-bottom) + 144px))');
    expect(phone?.body).not.toMatch(/padding-bottom:\s*max\(160px/);
    const range = /(?:^|\n)\.usage-segmented\s*\{([^}]*)\}/;
    expect(ruleDeclaration(source, range, 'border')).toBe('1px solid var(--rule)');
    expect(ruleDeclaration(source, range, 'background')).toBe('var(--surface-translucent)');
    // Only the page intro is a panel; the smoke-check timestamp inside the recorded smoke panel stays plain text.
    expect(source).toContain('.system-status-panel, .status-page > .system-status-snapshot, .usage-hero,');
    expect(source).not.toContain('.system-status-panel, .system-status-snapshot,');
    expect(ruleDeclaration(source, /\.status-page > \.system-status-snapshot\s*\{([^}]*)\}/, 'padding'))
      .toBe('var(--space-3) var(--space-4)');
    expect(source.match(/(?:^|\n)\.system-status-snapshot\s*\{([^}]*)\}/)?.[1] ?? '').not.toContain('padding');
  });

  it('keeps the Snooze menu inside the viewport and the time unbroken', () => {
    const proactive = readFileSync('src/proactive.css', 'utf8');
    const menu = /\.proactive-snooze-menu\s*\{\n\s*position: absolute;([^}]*)\}/;
    expect(ruleDeclaration(proactive, menu, 'width')).toBe('max-content');
    // A wrapping row would size to the sum of every option, so the menu stays a column.
    expect(ruleDeclaration(proactive, menu, 'flex-direction')).toBe('column');
    expect(ruleDeclaration(proactive, menu, 'flex-wrap')).toBe('nowrap');
    expect(ruleDeclaration(proactive, menu, 'max-width')).toBe('calc(100vw - 2 * var(--space-3))');
    expect(ruleDeclaration(proactive, /\.proactive-snooze-time\s*\{([^}]*)\}/, 'flex')).toBe('none');
    expect(ruleDeclaration(proactive, /\.proactive-snooze-time\s*\{([^}]*)\}/, 'white-space')).toBe('nowrap');
    // Only the time is kept on one line; a long label may wrap inside its own button instead of overflowing.
    expect(proactive.match(/\.proactive-snooze-menu \.secondary-button\s*\{([^}]*)\}/)?.[1] ?? '').not.toContain('white-space');
    const phone = mediaBlocks(proactive).find(({ query }) => /max-width:\s*700px/.test(query))?.body ?? '';
    const phoneMenu = /\.proactive-snooze-menu\s*\{([^}]*)\}/;
    expect(ruleDeclaration(phone, phoneMenu, 'right')).toBe('0');
    expect(ruleDeclaration(phone, phoneMenu, 'left')).toBe('auto');
    expect(ruleDeclaration(phone, phoneMenu, 'width')).toBe('calc(200% + var(--space-2))');
    expect(phone).toMatch(/\.proactive-item-actions \.secondary-button,\s*\.proactive-snooze\s*\{\s*flex: 1 1 calc\(50% - 6px\);/);
  });

  it('keeps overlay headings, attention rows and small links on one hierarchy and touch size', () => {
    expect(ruleDeclaration(source, /\.jobs-popover-heading\s*\{([^}]*)\}/, 'font-size')).toBe('var(--type-subheading)');
    expect(mediaBlocks(source).some(({ query, body }) => /max-width:\s*700px/.test(query)
      && /\.attention-popover \.activity-item\s*\{\s*align-items:\s*flex-start;\s*\}/.test(body))).toBe(true);
    const coarse = (css: string) => mediaBlocks(css).filter(({ query }) => query.trim() === '(pointer: coarse)')
      .map(({ body }) => body).join('\n');
    expect(ruleDeclaration(coarse(source), /\.usage-rank-label a\s*\{([^}]*)\}/, 'min-height')).toBe('44px');
    expect(ruleDeclaration(coarse(readFileSync('src/proactive.css', 'utf8')), /\.proactive-budget a\s*\{([^}]*)\}/, 'min-height'))
      .toBe('44px');
  });

  it('keeps action group order in markup and the deployment form row gap on the spacing scale', () => {
    const actionGroups = ['button-group', 'settings-actions', 'task-dialog-actions', 'action-row', 'settings-save'];
    const rules = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    for (const [, selectors, declarations] of rules) {
      if (actionGroups.some((name) => new RegExp(`\\.${name}(?![\\w-])`).test(selectors!))) {
        expect(declarations).not.toMatch(/(?:^|;)\s*order\s*:/);
      }
    }

    expect(ruleDeclaration(source, /\.deployment-add\s*\{([^}]*)\}/, 'row-gap')).toBe('var(--space-3)');
  });

  it('keeps primary actions after sibling controls in shared action groups', () => {
    const classes = new Set(['button-group', 'settings-actions', 'task-dialog-actions', 'action-row', 'settings-save']);
    const violations: string[] = [];

    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(path);
        } else if (entry.isFile() && entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
          const component = readFileSync(path, 'utf8');
          const groupOpenings = /<div\b[^>]*className=(?:"([^"]*)"|{`([^`]*)`})[^>]*>/g;
          for (const match of component.matchAll(groupOpenings)) {
            const groupClasses = (match[1] ?? match[2] ?? '').split(/\s+/);
            if (!groupClasses.some((name) => classes.has(name))) continue;

            const start = match.index! + match[0].length;
            const close = matchingDivClose(component, match.index!, match[0].length);
            const controls = [...component.slice(start, close).matchAll(/<(?:button|a)\b[^>]*>/g)];
            if (controls.length < 2) continue;

            const primaryIndex = controls.findIndex(([control]) =>
              /className=(?:"[^"]*\b(?:primary-button|danger-button--filled)\b[^"]*"|{[^}]*\b(?:primary-button|danger-button--filled)\b[^}]*})/.test(control));
            const confirmedCancel = path.endsWith('/factory/TaskControls.tsx') &&
              component.slice(start, close).includes('This ends the task and cannot be undone.');
            if (primaryIndex !== -1 && primaryIndex !== controls.length - 1 && !confirmedCancel) {
              violations.push(`${path}: primary action precedes another control in .${groupClasses.find((name) => classes.has(name))}`);
            }
          }
        }
      }
    };
    visit('src');

    expect(violations).toEqual([]);
  });

  it('keeps the Settings save bar frameless, nested sections shrinkable and task window links touch-sized', () => {
    expect(ruleDeclaration(source, /\.settings-page > \.settings-save\s*\{([^}]*)\}/, 'border')).toBe('0');
    const nestedTitle = /\.collapsible-inner \.collapsible-title\s*\{([^}]*)\}/;
    expect(ruleDeclaration(source, nestedTitle, 'flex')).toBe('0 1 auto');
    expect(ruleDeclaration(source, nestedTitle, 'min-width')).toBe('min-content');
    expect(ruleDeclaration(source, /\.collapsible-inner \.collapsible-toggle\s*\{([^}]*)\}/, 'font-size'))
      .toBe('var(--type-subsection)');
    expect(source).toContain('.collapsible-section[data-open="true"] > .collapsible-body > .collapsible-inner { padding-bottom: var(--space-5); }');
    expect(source).not.toContain('.collapsible-section[data-open="true"] .collapsible-inner { padding-bottom');
    expect(ruleDeclaration(source, /\.app-shell \.proactive-feed-input\s*\{([^}]*)\}/, 'align-items')).toBe('stretch');
    expect(ruleDeclaration(source, /\.app-shell \.proactive-feeds > \.secondary-button\s*\{([^}]*)\}/, 'justify-self'))
      .toBe('start');
    expect(source).toMatch(/^\.task-trail \.timeline-payload summary \{/m);
    const coarse = mediaBlocks(source).filter(({ query }) => query.trim() === '(pointer: coarse)')
      .map(({ body }) => body).join('\n');
    expect(ruleDeclaration(coarse, /\.task-trail \.timeline-payload summary\s*\{([^}]*)\}/, 'min-height')).toBe('44px');
    expect(ruleDeclaration(coarse, /a\.task-chip\s*\{([^}]*)\}/, 'min-height')).toBe('44px');
  });

  it('removes decorative control rims without removing neutral field structure or focus', () => {
    for (const selector of [
      /\.release-trail-button, \.release-trail-open\s*\{([^}]*)\}/,
    ]) expect(ruleDeclaration(source, selector, 'border')).toBe('0');
    expect(ruleDeclaration(source, /\.primary-button, \.secondary-button, \.ghost-button, \.danger-button\s*\{([^}]*)\}/, 'border'))
      .toBe('1px solid transparent');
    expect(source).toContain('border-color: color-mix(in srgb, var(--primary-action) 54%, var(--highlight-solid));');
    expect(source).toContain('border-color: var(--control-rule); background: color-mix(in srgb, var(--text) 6%, var(--surface)); color: var(--text);');
    const controlRule = /([^{}]+)\{([^{}]*)\}/g;
    for (const [, selectors, declarations] of source.matchAll(controlRule)) {
      if (!/(?:settings-back|signin-button|release-trail-button|release-trail-open|presence-mode-card|memory-item|knowledge-reset|knowledge-legend|usage-segmented|advanced-segmented)/.test(selectors!)) continue;
      expect(declarations, selectors).not.toMatch(/box-shadow:[^;]*(?:inset|glass-selected-glow)/);
    }
    expect(ruleDeclaration(source, /\.knowledge-search\.luminous-glass\s*\{([^}]*)\}/, 'border-color')).toBe('var(--control-rule)');
    expect(ruleDeclaration(source, /\.signin-button\.luminous-glass::before\s*\{([^}]*)\}/, 'content')).toBe('none');
    expect(source).toContain('.primary-button:focus-visible');
    expect(source).toContain('.danger-button--filled:focus-visible');
    expect(source).toContain('.knowledge-search:has(input:focus-visible) { border-color: var(--field-focus-rule); box-shadow: var(--field-focus-glow); }');
    expect(source).toContain('.workspaces-search:has(input:focus-visible) { border-color: var(--field-focus-rule); box-shadow: var(--field-focus-glow); }');
    expect(source).not.toContain(') :is(input, select, textarea):focus-visible');
    expect(source).toContain('border: 1px solid var(--field-rim, var(--control-rule));');
    expect(source).toContain('--field-rim: var(--field-focus-rule);');
    expect(ruleDeclaration(source, /\.app-shell input\[type="range"\]:focus-visible,[^{]*\{([^}]*)\}/, 'outline')).toBe('3px solid var(--focus)');
  });

  function matchingDivClose(source: string, openingIndex: number, openingLength: number): number {
    const tags = /<\/?div\b[^>]*>/g;
    tags.lastIndex = openingIndex + openingLength;
    let depth = 1;
    for (const match of source.matchAll(tags)) {
      const tag = match[0];
      if (tag.startsWith('</')) {
        depth -= 1;
        if (depth === 0) return match.index!;
      } else if (!tag.endsWith('/>')) {
        depth += 1;
      }
    }
    throw new Error(`No closing div for opening at ${openingIndex} (${openingLength} characters)`);
  }

  it('draws slim arrowless desktop scrollbars and keeps the glass ring from adding phantom ones', () => {
    expect(ruleDeclaration(source, /\* \{ (scrollbar-width: thin;[^}]*)\}/, 'scrollbar-width')).toBe('thin');
    const parts = source.match(/@supports selector\(::-webkit-scrollbar\) \{\s*@media \(pointer: fine\) \{([\s\S]*?)\n {2}\}\n\}/)?.[1] ?? '';
    expect(parts).toContain('* { scrollbar-width: auto; scrollbar-color: auto; }');
    // Safari only restyles the hovered thumb when a custom property changes on the scroller.
    expect(parts).toMatch(/:hover \{\s*scrollbar-color: auto;\s*--scrollbar-hover-sync: ;/);
    expect(ruleDeclaration(parts, /\n\s*::-webkit-scrollbar-button\s*\{([^}]*)\}/, 'display')).toBe('none');
    expect(ruleDeclaration(parts, /\n\s*::-webkit-scrollbar-thumb\s*\{([^}]*)\}/, 'border-radius')).toBe('var(--radius-pill)');
    // The 1px glass ring overhangs its box, so a glass surface that scrolls must drop the ring or stop being the scroller.
    expect(ruleDeclaration(source, /\.knowledge-results\.luminous-glass::before\s*\{([^}]*)\}/, 'content')).toBe('none');
    expect(ruleDeclaration(source, /\n\.modal\s*\{([^}]*)\}/, 'overflow')).toBe('hidden');
    expect(ruleDeclaration(source, /\n\.modal\s*\{([^}]*)\}/, 'max-height')).toBe('100%');
    expect(ruleDeclaration(source, /\.modal\.luminous-glass::before\s*\{([^}]*)\}/, 'content')).toBe('none');
    expect(ruleDeclaration(source, /\.modal-body\s*\{([^}]*)\}/, 'overflow')).toBe('auto');
  });

  it('reserves pills for labelled status and genuine switch tracks', () => {
    expect(ruleDeclaration(source, /\.task-chip, \.task-state-chip\s*\{([^}]*)\}/, 'border-radius')).toBe('var(--radius-pill)');
    expect(ruleDeclaration(source, /\.kanban-pulse li\s*\{([^}]*)\}/, 'border-radius')).toBe('var(--radius-pill)');
    expect(ruleDeclaration(source, /\.advanced-toggle input\[role="switch"\]\s*\{([^}]*)\}/, 'border-radius')).toBe('var(--radius-pill)');
    expect(ruleDeclaration(source, /\.advanced-toggle input\[role="switch"\]:checked::after\s*\{([^}]*)\}/, 'translate')).toBe('18px 0');
  });

  it('retains selected surface roles and makes compact route controls touch-sized', () => {
    const toastSource = readFileSync('src/ConversationToast.css', 'utf8');
    expect(ruleDeclaration(toastSource, /\.conversation-toast \.conversation-toast-action:active\s*\{([^}]*)\}/, 'background'))
      .toBe('var(--state-selected-pressed)');
    for (const selector of [
      /\.memory-item\[aria-pressed="true"\]\s*\{([^}]*)\}/,
      /\.knowledge-results button\[aria-pressed="true"\]\s*\{([^}]*)\}/,
      /\.usage-segmented button\[aria-pressed="true"\]\s*\{([^}]*)\}/,
      /\.advanced-segmented button\[aria-pressed="true"\]\s*\{([^}]*)\}/,
    ]) {
      expect(ruleDeclaration(source, selector, 'background')).toBe('var(--state-selected-bg)');
      expect(ruleDeclaration(source, selector, 'font-weight')).toBe('750');
    }
    expect(source).toContain('.workspaces-kind, .memory-item, .knowledge-results button,');
    expect(source).toContain('@media (pointer: coarse) {\n  :is(.primary-button, .secondary-button, .ghost-button, .danger-button, .settings-back,');
    expect(source).toContain('.knowledge-legend button,');
    expect(source).toContain('.workspaces-action { width: 44px; height: 44px; }');
    expect(source).toContain('.release-trail-button { width: 44px; min-height: 44px; }');
    expect(source).toContain('.app-shell[data-phone="true"] .knowledge-legend button { min-height: 44px;');
  });

  it('keeps fields and choice controls on the shared tokenized system', () => {
    const sharedFields = source.match(/\/\* P14-08: one shared field and choice-control system across application routes\. \*\/([\s\S]*)$/)?.[1] ?? '';
    const taskDetail = readFileSync('src/factory/TaskDetailPage.tsx', 'utf8');
    const notes = readFileSync('src/notes/NotesArea.tsx', 'utf8');
    const noteFolders = readFileSync('src/notes/NoteFolderPicker.tsx', 'utf8');
    const coarsePointerFields = sharedFields.match(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(sharedFields).toContain('var(--control-rule)');
    expect(sharedFields).toContain('var(--radius-control)');
    expect(sharedFields).toContain('var(--surface)');
    expect(sharedFields).toContain('var(--type-body)');
    expect(sharedFields).toContain('var(--focus)');
    expect(sharedFields).toContain('min-height: 38px;');
    expect(sharedFields).toContain('padding: var(--space-1) var(--field-padding-end, var(--space-3)) var(--space-1) var(--field-padding-start, var(--space-3));');
    expect(sharedFields).toMatch(/\) select \{\s*appearance: none;\s*--field-padding-end: var\(--space-6\);\s*text-overflow: ellipsis;/);
    expect(sharedFields).toMatch(/\.app-shell \.kanban-search input \{\s*--field-padding-start: var\(--space-7\);\s*\}/);
    expect(sharedFields).toContain('min-height: 120px;');
    expect(sharedFields).toContain('resize: vertical;');
    expect(sharedFields).toMatch(/:focus-visible/);
    expect(sharedFields).toMatch(/:disabled/);
    expect(sharedFields).toMatch(/:read-only/);
    expect(sharedFields).toMatch(/\[aria-invalid="true"\]/);
    expect(sharedFields).toMatch(/\[aria-busy="true"\]/);
    expect(sharedFields).toMatch(/:autofill/);
    expect(coarsePointerFields).toContain(':not([type="file"]):not([type="hidden"])');
    expect(coarsePointerFields).toContain('min-height: 44px;');
    expect(coarsePointerFields).toContain('min-height: 120px;');
    expect(coarsePointerFields).toContain('font-size: var(--type-body);');
    expect(coarsePointerFields).toContain('.app-shell .composer textarea');
    expect(sharedFields).toMatch(/\.app-shell :is\(\.knowledge-search input, \.workspaces-search input\)\s*\{\s*min-height: 38px;\s*font: var\(--type-body\)\/var\(--line-body\) var\(--font-body\);/);
    expect(sharedFields).toContain('.form-control');
    expect(sharedFields).toContain('background-size: 5px 5px;');
    expect(ruleDeclaration(source, /\.form-control\s*\{([^}]*)\}/, 'border-radius')).toBe('var(--radius-control)');
    expect(sharedFields).toContain('input[role="switch"]::after');
    expect(sharedFields).toContain('accent-color: var(--focus);');
    expect(taskDetail).toContain('className="task-timeline-filter form-control"');
    expect(notes).toContain('className="form-control" placeholder="Note title"');
    expect(noteFolders).toContain('className="form-control" value={name}');
  });
});

describe('generated view styling', () => {
  const source = readFileSync('src/styles.css', 'utf8');

  it('keeps table scrolling and source notes while using shared surface, type, and spacing tokens', () => {
    expect(ruleDeclaration(source, /\.generated-view-table\s*\{([^}]*)\}/, 'overflow')).toBe('auto');
    expect(ruleDeclaration(source, /\.generated-view-table th, \.generated-view-table td\s*\{([^}]*)\}/, 'overflow-wrap'))
      .toBe('normal');
    expect(ruleDeclaration(source, /\.generated-view-table th\s*\{([^}]*)\}/, 'background')).toBe('var(--surface-muted)');
    expect(ruleDeclaration(source, /\.generated-view-source-note\.generated-view-source-note\s*\{([^}]*)\}/, 'font-size'))
      .toBe('var(--type-caption)');
    expect(ruleDeclaration(source, /\.generated-view-timeline\.generated-view-timeline\s*\{([^}]*)\}/, 'gap'))
      .toBe('var(--space-4)');
    expect(ruleDeclaration(source, /\.generated-chart\s*\{([^}]*)\}/, 'gap')).toBe('var(--space-2)');
    expect(ruleDeclaration(source, /\.generated-chart text\s*\{([^}]*)\}/, 'font-size')).toBe('var(--type-caption)');
  });
});

function tokenValue(source: string, selector: string, name: string): string {
  const rule = source.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1];
  const value = rule?.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1];
  if (!value) throw new Error(`Missing ${name} in ${selector}`);
  return value;
}

function ruleDeclaration(source: string, selector: RegExp, name: string): string {
  const rule = source.match(selector)?.[1];
  const value = rule?.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1];
  if (!value) throw new Error(`Missing ${name} in ${selector}`);
  return value;
}

function parseColor(value: string): { color: Color; alpha: number } {
  const hex = value.match(/^#([a-f\d]{6})$/i)?.[1];
  if (hex) {
    return {
      color: [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as Color,
      alpha: 1,
    };
  }

  const rgb = value.match(/^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)%\)$/);
  if (!rgb) throw new Error(`Unsupported color token: ${value}`);
  return {
    color: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])],
    alpha: Number(rgb[4]) / 100,
  };
}

function composite(foreground: Color, alpha: number, background: Color): Color {
  const [red, green, blue] = foreground.map(
    (channel, index) => channel * alpha + background[index]! * (1 - alpha),
  ) as Color;
  return [red, green, blue];
}

function luminance([red, green, blue]: Color): number {
  const linear = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const [redLinear, greenLinear, blueLinear] = linear as Color;
  return redLinear * 0.2126 + greenLinear * 0.7152 + blueLinear * 0.0722;
}

function contrast(first: Color, second: Color): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

function hue([red, green, blue]: Color): number {
  const [r, g, b] = [red / 255, green / 255, blue / 255] as Color;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const sector = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (sector * 60 + 360) % 360;
}

describe('shared glass tokens', () => {
  it('avoids nested window blur and pauses ambient CSS motion behind work pages', () => {
    const source = readFileSync('src/styles.css', 'utf8');
    expect(ruleDeclaration(source, /\.workspace-window \.panel\s*\{([^}]*)\}/, 'backdrop-filter')).toBe('none');
    expect(ruleDeclaration(source,
      /\.app-shell\[data-home="false"\]\[data-voice-active="false"\]::before,\s*\.app-shell[^{}]+\{([^}]*)\}/,
      'animation-play-state')).toBe('paused');
  });

  it('shrinks header tabs before scrolling without borrowing the fixed controls space', () => {
    const source = readFileSync('src/styles.css', 'utf8');
    expect(ruleDeclaration(source, /\.topbar-context\s*\{([^}]*)\}/, 'flex')).toBe('0 0 auto');
    expect(ruleDeclaration(source, /\.topbar-actions\s*\{([^}]*)\}/, 'flex')).toBe('0 0 auto');
    expect(ruleDeclaration(source, /\.app-topbar \.window-tabstrip \.window-tabbar\s*\{([^}]*)\}/, 'min-width')).toBe('0');
    expect(ruleDeclaration(source, /\.app-topbar \.window-tabstrip \.workspace-tabs\s*\{([^}]*)\}/, 'width')).toBe('100%');
    expect(ruleDeclaration(source, /\.app-topbar \.window-tabstrip \.workspace-tabs\s*\{([^}]*)\}/, 'overflow-x')).toBe('auto');
    expect(ruleDeclaration(source, /\.window-tabstrip \.workspace-tab-item\s*\{([^}]*)\}/, 'flex')).toBe('0 1 240px');
    expect(ruleDeclaration(source, /\.window-tabstrip \.workspace-tab-item\s*\{([^}]*)\}/, 'min-width')).toBe('140px');
    expect(ruleDeclaration(source, /\.job-tab-list\s*\{([^}]*)\}/, 'overflow-x')).toBe('auto');
    expect(ruleDeclaration(source, /\.job-tab-list\s*\{([^}]*)\}/, 'overflow-y')).toBe('hidden');
    expect(ruleDeclaration(source, /\.job-tab-list\s*\{([^}]*)\}/, 'scrollbar-width')).toBe('none');
    expect(source).toContain('.app-shell[data-phone="true"] .job-tab-list { display: none; }');
    expect(source).toContain('.app-shell[data-phone="true"] .job-tabs { flex: 0 0 auto; margin-left: auto; }');
  });

  it('keeps the phone top bar inside 320px: Settings lives in the menu and presence yields on narrow handsets', () => {
    const source = readFileSync('src/styles.css', 'utf8');
    expect(ruleDeclaration(source, /\.app-shell\[data-phone="true"\] \.settings-link\s*\{([^}]*)\}/, 'display')).toBe('none');
    expect(ruleDeclaration(source, /\.app-shell\[data-phone="true"\] \.app-topbar\s*\{([^}]*)\}/, 'position')).toBe('sticky');
    expect(ruleDeclaration(source, /\.app-shell\[data-phone="true"\] \.app-topbar\s*\{([^}]*)\}/, 'top')).toBe('env(safe-area-inset-top)');
    const narrow = mediaBlocks(source).filter(({ query }) => /max-width:\s*380px/.test(query)).map(({ body }) => body).join('\n');
    expect(narrow).toMatch(/\.app-shell\[data-phone="true"\] \.presence-chip\s*\{\s*display:\s*none;\s*\}/);
    expect(ruleDeclaration(source, /\.app-shell\[data-phone="true"\] \.topbar-actions\s*\{([^}]*)\}/, 'gap')).toBe('0');
  });

  it('keeps phone message times below the bubble text instead of overlapping it', () => {
    const history = readFileSync('src/ConversationHistory.css', 'utf8');
    expect(ruleDeclaration(history, /\.conversation-message \.message-metadata\s*\{([^}]*)\}/, 'position')).toBe('absolute');
    const phoneRules = mediaBlocks(history).filter(({ query }) => /max-width:\s*700px/u.test(query)).map(({ body }) => body).join('\n');
    expect(ruleDeclaration(phoneRules, /\.conversation-message \.message-metadata\s*\{([^}]*)\}/, 'position')).toBe('static');
    expect(ruleDeclaration(phoneRules, /\.conversation-message \.message-metadata\s*\{([^}]*)\}/, 'margin')).toBe('var(--space-2) 0 0 auto');
    const touchRules = mediaBlocks(history).filter(({ query }) => /hover:\s*none/u.test(query)).map(({ body }) => body).join('\n');
    expect(touchRules).toContain('.message-metadata { opacity: 1; }');
  });

  it('keeps message times below the bubble without covering its text', () => {
    const history = readFileSync('src/ConversationHistory.css', 'utf8');
    expect(ruleDeclaration(history, /\.conversation-message \.message-metadata\s*\{([^}]*)\}/, 'position')).toBe('absolute');
    expect(ruleDeclaration(history, /\.conversation-message \.message-metadata\s*\{([^}]*)\}/, 'top')).toBe('calc(100% + var(--space-1))');
    expect(ruleDeclaration(history, /\.conversation-message\s*\{([^}]*)\}/, 'margin')).toBe('var(--space-4) 0 calc(var(--space-4) + var(--space-2))');
    const touchRules = mediaBlocks(history).filter(({ query }) => /hover:\s*none/u.test(query)).map(({ body }) => body).join('\n');
    expect(touchRules).toContain('.message-metadata { opacity: 1; }');
  });

  it('keeps phone icon actions below a full-width draft', () => {
    const history = readFileSync('src/ConversationHistory.css', 'utf8');
    expect(history).toContain('grid-template-columns: 44px minmax(0, 1fr) 44px 44px');
    expect(history).toContain('.composer > .composer-dictate { display: inline-flex; grid-column: 3;');
    expect(history).toContain('.composer > .composer-send { display: grid; grid-column: 4;');
    expect(history).toContain('.composer > :is(textarea, .composer-prompt) { grid-column: 1 / -1; grid-row: 1; }');
    expect(history).toContain('.composer > :is(.composer-more, .composer-screen-stop, .composer-dictate, .composer-send) { grid-row: 2; }');
  });

  it('keeps phone window rows at their natural touch height rather than the desktop tab basis', () => {
    const source = readFileSync('src/styles.css', 'utf8');
    const phoneRow = /\.app-shell\[data-phone="true"\]\[data-windows-open="true"\] \.window-tabstrip \.workspace-tab-item\s*\{([^}]*)\}/;
    expect(ruleDeclaration(source, phoneRow, 'flex')).toBe('0 0 auto');
    expect(ruleDeclaration(source, phoneRow, 'width')).toBe('100%');
    expect(ruleDeclaration(source, phoneRow, 'max-width')).toBe('none');
    expect(ruleDeclaration(source, phoneRow, 'height')).toBe('44px');
    expect(ruleDeclaration(source, phoneRow, 'padding')).toBe('0');
  });

  it('anchors both phone chat surfaces to the same visual viewport and measured composer height', () => {
    const history = readFileSync('src/ConversationHistory.css', 'utf8');
    const phoneChat = history.slice(history.indexOf('/* Both halves of phone chat'));
    expect(phoneChat).toContain('top: calc(var(--phone-chat-top, 0px) + env(safe-area-inset-top) + var(--rail-size) + 8px)');
    expect(phoneChat).toContain('top: calc(var(--phone-chat-top, 0px) + var(--phone-chat-height, 100dvh) - var(--phone-dock-bottom) - var(--conversation-composer-height, 52px))');
    expect(phoneChat).toContain('height: max(0px, calc(var(--phone-chat-height, 100dvh) - env(safe-area-inset-top) - var(--rail-size) - 8px - var(--phone-dock-bottom) - var(--conversation-composer-height, 52px) + 2px))');
    expect(phoneChat).not.toContain('--phone-chat-bottom');
    expect(phoneChat).toContain('[data-phone="true"][data-voice-active="false"]');
    expect(phoneChat).not.toContain('transform:');
    expect(history).toContain('.app-shell[data-phone="false"][data-voice-active="false"][data-home="false"]:has(.workspace[data-conversation-positioned])');
  });

  it('keeps phone pages clear of the measured composer so a bottom action such as Save settings stays reachable', () => {
    const history = readFileSync('src/ConversationHistory.css', 'utf8');
    const styles = readFileSync('src/styles.css', 'utf8');
    const clearance = ruleDeclaration(history,
      /\.app-shell\.app-shell\[data-phone="true"\]\[data-voice-active="false"\]\[data-home="false"\]:not\(\.app-signed-out\) \.shell-main\s*\{([^}]*)\}/,
      'padding-bottom');
    // Floor: the nominal dock, so a one-line composer looks as before. Growth: the live composer height, set from its measured box.
    expect(clearance).toBe('max(calc(var(--dock-space) + var(--space-4)), calc(var(--phone-dock-bottom) + var(--conversation-composer-height, var(--space-7)) + var(--space-4)))');
    expect(ruleDeclaration(styles, /\.app-shell\[data-phone="true"\]\[data-home="false"\] \.shell-main\s*\{([^}]*)\}/, 'padding-bottom'))
      .toBe('calc(var(--dock-space) + var(--space-4))');
    // The settings Save row stays a plain row at the end of the page (Dan, 8 October), so clearance is the fix, not a sticky pill.
    expect(ruleDeclaration(styles, /\.settings-page > \.settings-save\s*\{([^}]*)\}/, 'position')).toBe('static');
  });

  it('lets table replies use the transcript width without widening ordinary prose', () => {
    const history = readFileSync('src/ConversationHistory.css', 'utf8');
    expect(ruleDeclaration(history,
      /\.conversation-message:has\(\.markdown-table-scroll\), \.streaming-message:has\(\.markdown-table-scroll\)\s*\{([^}]*)\}/,
      'max-width')).toBe('100%');
    expect(history).toContain('.conversation-message { max-width: min(80%, 58ch);');
    expect(ruleDeclaration(history, /\.markdown-table-scroll\s*\{([^}]*)\}/, 'overflow-x')).toBe('auto');
  });

  it('enables edge-to-edge phone viewports and a standalone Home Screen app using the existing icon', () => {
    const html = readFileSync('index.html', 'utf8');
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    expect(html).toContain('content="width=device-width, initial-scale=1.0, viewport-fit=cover"');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain(`<meta name="theme-color" content="${manifest.theme_color}"`);
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(manifest).toMatchObject({
      name: 'Jarvis', display: 'standalone', start_url: '/', background_color: '#20252c',
      icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    });
    const hosting = JSON.parse(readFileSync('public/staticwebapp.config.json', 'utf8'));
    expect(hosting.navigationFallback.exclude).toContain('/manifest.webmanifest');
  });

  it('shares an additive phone safe-area gap across the composer, voice, feedback and window dock', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const history = readFileSync('src/ConversationHistory.css', 'utf8');
    const voice = readFileSync('src/VoiceControls.css', 'utf8');
    const toasts = readFileSync('src/ConversationToast.css', 'utf8');
    expect(styles).toContain('@media (max-width: 700px), (max-height: 500px) and (pointer: coarse) {\n  :root { --mobile-nav-height: 68px; --phone-dock-bottom: calc(env(safe-area-inset-bottom) + var(--mobile-nav-height) + 16px); }');
    expect(ruleDeclaration(styles, /\.app-shell\.app-signed-out\s*\{([^}]*)\}/, 'padding')).toBe('env(safe-area-inset-top) calc(env(safe-area-inset-right) + var(--space-5)) env(safe-area-inset-bottom) calc(env(safe-area-inset-left) + var(--space-5))');
    expect(ruleDeclaration(styles, /\.app-shell\[data-phone="true"\]\s*\{([^}]*)\}/, '--dock-space')).toBe('calc(68px + var(--phone-dock-bottom))');
    expect(ruleDeclaration(styles, /\.app-shell\[data-phone="true"\]\[data-home="true"\] \.jarvis-page\s*\{([^}]*)\}/, 'padding-bottom')).toBe('var(--phone-dock-bottom)');
    expect(ruleDeclaration(styles, /\.app-shell\[data-phone="true"\]\[data-home="false"\]:not\(\.app-signed-out\) \.jarvis-page\s*\{([^}]*)\}/, 'bottom')).toBe('var(--phone-dock-bottom)');
    expect(history).toContain('bottom: var(--phone-dock-bottom)');
    expect(history).not.toContain('--phone-dock-bottom:');
    expect(voice).toContain('bottom: calc(var(--phone-dock-bottom) + var(--phone-dock-height) + 12px)');
    expect(toasts).toContain('bottom: calc(var(--phone-dock-bottom) + 88px)');
    expect(ruleDeclaration(styles, /\.app-shell\[data-phone="true"\]\s*\{([^}]*)\}/, 'padding')).toBe('env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left)');
    expect(ruleDeclaration(styles, /\.app-shell\s*\{([^}]*)\}/, 'height')).toBe('100vh');
    expect(styles).toContain('height: 100dvh;');
  });

  it('keeps text, muted text, and icon contrast on glass surfaces in both appearances', () => {
    const source = readFileSync('src/styles.css', 'utf8');
    const iconSource = readFileSync('src/ShellIcon.tsx', 'utf8');
    const appearances = [
      { selector: ':root' },
      { selector: ':root\\[data-theme="dark"\\]' },
    ];
    const shellIconColor = ruleDeclaration(
      source,
      /\.rail-button, \.rail-link, \.sidebar-close, \.topbar-icon-button\s*\{([^}]*)\}/,
      'color',
    );
    const sidebarTextColor = ruleDeclaration(
      source,
      /\.sidebar-link\s*\{([^}]*)\}/,
      'color',
    );
    const topbarTextColor = ruleDeclaration(
      source,
      /\.topbar-context\s*\{([^}]*)\}/,
      'color',
    );

    expect(shellIconColor).toBe('var(--secondary-accent)');
    expect(sidebarTextColor).toBe('var(--text-muted)');
    expect(topbarTextColor).toBe('var(--text-muted)');
    expect(iconSource).toContain("stroke: 'currentColor'");

    for (const { selector } of appearances) {
      const text = parseColor(tokenValue(source, selector, '--text'));
      const mutedText = parseColor(tokenValue(source, selector, '--text-muted'));
      const icon = parseColor(tokenValue(source, selector, shellIconColor.slice(4, -1)));
      const focus = parseColor(tokenValue(source, selector, '--focus'));

      for (const surfaceName of ['--surface-translucent', '--surface-muted']) {
        const surface = parseColor(tokenValue(source, selector, surfaceName));
        expect(surface.alpha).toBeGreaterThanOrEqual(0.88);
        for (const backdrop of [[0, 0, 0], [255, 255, 255]] as Color[]) {
          const renderedSurface = composite(surface.color, surface.alpha, backdrop);
          expect(contrast(text.color, renderedSurface)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(mutedText.color, renderedSurface)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(icon.color, renderedSurface)).toBeGreaterThanOrEqual(3);
          expect(contrast(focus.color, renderedSurface)).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('keeps sign-in copy below the orb with a keyboard-visible glass action', () => {
    const source = readFileSync('src/styles.css', 'utf8');
    const layout = /\.signin\s*\{([^}]*)\}/;
    const action = /\.signin-button\s*\{([^}]*)\}/;

    expect(ruleDeclaration(source, layout, 'align-content')).toBe('end');
    expect(ruleDeclaration(source, action, 'min-height')).toBe('52px');
    expect(ruleDeclaration(source, action, 'background')).toContain('var(--surface-translucent)');
    expect(source.match(action)?.[1]).toMatch(/(?:^|;\s*)color:\s*var\(--text\);/);
    expect(source).toContain('.signin-button:focus-visible { outline: 3px solid var(--focus);');
    expect(source).toContain('.app-shell.app-signed-out:has(.signin) .signin { padding-bottom: var(--space-4); }');
  });

  it('keeps rendered conversation paragraphs on the primary text role', () => {
    const source = readFileSync('src/ConversationHistory.css', 'utf8');

    expect(ruleDeclaration(source, /\.markdown-content p\s*\{([^}]*)\}/, 'color')).toBe('inherit');
  });

  it('lets the inner composer fill the measured stack and retains default dock width', () => {
    const source = readFileSync('src/ConversationHistory.css', 'utf8');
    const selector = '.app-shell[data-phone="false"][data-voice-active="false"][data-conversation-open="true"]:has(.workspace-window-conversation.workspace-window-maximized:not(.workspace-window-minimized, [hidden])) .jarvis-page';
    expect(source).toContain(`${selector} { --chat-width: 100%; }`);
    expect(ruleDeclaration(source, /\.conversation-input\s*\{([^}]*)\}/, 'max-width')).toBe('none');
    expect(ruleDeclaration(source, /\.conversation-input-stack\s*\{([^}]*)\}/, 'max-width')).toBe('var(--chat-width)');
    expect(ruleDeclaration(source, /\.app-shell\[data-home="false"\]:not\(\.app-signed-out\) \.jarvis-page\s*\{([^}]*)\}/, 'max-width')).toBe('var(--chat-width)');
    expect(source).toContain(':root { --chat-width: 740px;');
  });

  it('keeps chat type compact without shrinking the composer or touch resize borders', () => {
    const source = readFileSync('src/ConversationHistory.css', 'utf8');
    expect(source).toContain('font-size: var(--type-small); line-height: var(--line-prose);');
    expect(source).toContain('.conversation-message :where(p, li, blockquote) { font-size: inherit; line-height: inherit; }');
    expect(source).toContain('font-size: var(--type-body); line-height: var(--line-body);');
    expect(source).toContain('.conversation-resize-corner { width: 44px; height: 44px; }');
    expect(source).toContain('.conversation-resize-border-top { top: -10px; height: 24px;');
    expect(source).not.toContain('.conversation-corner svg');
    expect(source).toContain('var(--conversation-height, min(var(--chat-height), 44vh))');
  });

  it('keeps chat side resizing outside the transcript and excludes the inner corner quadrants', () => {
    const source = readFileSync('src/ConversationHistory.css', 'utf8');
    for (const side of ['left', 'right']) {
      const rules = [...source.matchAll(new RegExp(`\\.conversation-resize-border-${side}\\s*\\{([^}]*)\\}`, 'g'))];
      expect(rules).toHaveLength(2);
      for (const [, declarations] of rules) {
        const offset = Number(declarations!.match(new RegExp(`${side}: (-?\\d+)px;`))?.[1]);
        const width = Number(declarations!.match(/width: (\d+)px;/)?.[1]);
        expect(width).toBeGreaterThan(0);
        expect(offset + width).toBe(0);
      }
    }
    expect(source).toContain('clip-path: polygon(0 0, 100% 0, 100% 50%, 50% 50%, 50% 100%, 0 100%)');
    expect(source).toContain('clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 100%, 50% 50%, 0 50%)');
    expect(source).toContain('clip-path: polygon(0 0, 50% 0, 50% 50%, 100% 50%, 100% 100%, 0 100%)');
    expect(source).toContain('clip-path: polygon(50% 0, 100% 0, 100% 100%, 0 100%, 0 50%, 50% 50%)');
  });

  it('uses the accepted sans typography for shared headings', () => {
    const source = readFileSync('src/styles.css', 'utf8');

    expect(tokenValue(source, ':root', '--font-heading')).toBe('var(--font-body)');
  });

  it('shares one opaque report surface and keeps window controls in one row', () => {
    const source = readFileSync('src/styles.css', 'utf8');
    expect(tokenValue(source, ':root', '--report-surface')).toBe('#f0f5f7');
    expect(tokenValue(source, ':root\\[data-theme="dark"\\]', '--report-surface')).toBe('#091018');
    expect(ruleDeclaration(source, /\.workspace-window\.luminous-glass:has\(\.html-app\)\s*\{([^}]*)\}/, 'background')).toBe('var(--report-surface)');
    expect(ruleDeclaration(source, /\.html-app-frame\s*\{([^}]*)\}/, 'background')).toBe('var(--report-surface)');
    expect(ruleDeclaration(source, /\.html-app-frame\s*\{([^}]*)\}/, 'border-radius')).toBe('0');
    expect(source).not.toMatch(/\.workspace-window-actions[^{]*\{[^}]*grid-template-columns/);
    expect(source).toContain('.workspace-window-actions { display: flex; width: auto; flex: 0 0 auto; flex-wrap: nowrap; gap: var(--space-1); }');
  });

  it('gives window tabs compact corners, distinct pin states and touch-sized actions', () => {
    const source = readFileSync('src/styles.css', 'utf8');
    expect(source).not.toMatch(/\.workspace-window-actions[^{]*\{[^}]*grid-template-columns/);
    expect(source).toContain('.workspace-window-actions { display: flex; width: auto; flex: 0 0 auto; flex-wrap: nowrap; gap: var(--space-1); }');
    expect(ruleDeclaration(source, /\.workspace-tab-item\s*\{([^}]*)\}/, 'border-radius')).toBe('var(--radius-control)');
    expect(ruleDeclaration(source, /\.workspace-tab-close, \.workspace-tab-pin\s*\{([^}]*)\}/, 'width')).toBe('36px');
    expect(source).toContain('.workspace-tab-pin[aria-pressed="true"] svg { transform: none; }');
    expect(source).toContain('.workspace-tab-close, .workspace-tab-pin { width: 44px; min-width: 44px; height: 44px; min-height: 44px; }');
    expect(source).toContain(':root[data-motion="reduced"] .workspace-tab-pin svg { transition: none; }');
    expect(source).toContain('.app-shell[data-phone="true"][data-windows-open="true"] .app-topbar { z-index: var(--z-menu); }');
  });

  it('gives the empty conversation readable glass placement clear of the orb', () => {
    const styles = readFileSync('src/ConversationHistory.css', 'utf8');
    const greeting = ruleDeclaration(styles, /\.conversation-greeting\s*\{([^}]*)\}/, 'background');
    const greetingPosition = ruleDeclaration(styles, /\.conversation-greeting\s*\{([^}]*)\}/, 'align-self');
    const headingFont = ruleDeclaration(styles, /\.conversation-greeting h2\s*\{([^}]*)\}/, 'font-family');
    const emptyTranscriptLayout = ruleDeclaration(
      styles, /\.conversation-transcript:has\(\.conversation-greeting\)\s*\{([^}]*)\}/, 'display',
    );

    expect(greeting).toBe('var(--surface-translucent)');
    expect(greetingPosition).toBe('flex-end');
    expect(headingFont).toBe('var(--font-heading)');
    expect(emptyTranscriptLayout).toBe('flex');
    expect(styles).not.toContain('.conversation-overview');
    expect(styles).toContain('padding: clamp(var(--space-4), 12vh, var(--space-7)) var(--space-3)');
    expect(styles).toContain('@media (max-width: 700px)');
  });

  it('keeps the shared composer grid without inline voice feedback', () => {
    const styles = readFileSync('src/ConversationHistory.css', 'utf8');
    expect(styles).not.toContain('.voice-error');
    expect(styles).not.toContain('.voice-screen-error');
    expect(styles).toContain('.conversation-input[data-voice-active="false"] > .conversation-actions,\n'
      + '.conversation-input[data-voice-active="false"] .voice-controls[data-active="false"] { display: contents; }');
  });

  it('gives Jarvis replies a readable semantic glass surface over the stage', () => {
    const styles = readFileSync('src/ConversationHistory.css', 'utf8');
    const jarvisMessage = ruleDeclaration(
      styles, /\.conversation-message\[data-speaker="jarvis"\]\s*\{([^}]*)\}/, 'background',
    );

    expect(jarvisMessage).toBe('var(--surface-translucent)');
  });

  it('matches Plus-menu readability frost on both speakers’ bubbles', () => {
    const history = readFileSync('src/ConversationHistory.css', 'utf8');
    const bubbles = /\.conversation-message\[data-speaker="dan"\],\s*\.conversation-message\[data-speaker="jarvis"\]\s*\{([^}]*)\}/;
    const plusMenu = /\.app-shell \.composer-more :is\(\.more-menu-list, \.more-menu-flyout\)\s*\{([^}]*)\}/;

    for (const property of ['background', 'backdrop-filter', '-webkit-backdrop-filter']) {
      expect(ruleDeclaration(history, bubbles, property)).toBe(ruleDeclaration(sharedStyles, plusMenu, property));
    }
  });

  it('bounds phone voice to a transparent non-intercepting dock and keeps fullscreen rules desktop-only', () => {
    const history = readFileSync('src/ConversationHistory.css', 'utf8');
    const voice = readFileSync('src/VoiceControls.css', 'utf8');
    const styles = readFileSync('src/styles.css', 'utf8');
    const dock = /\.app-shell\[data-phone="true"\]\[data-voice-active="true"\] \.voice-controls\[data-active="true"\]\s*\{([^}]*)\}/;
    expect(ruleDeclaration(history, dock, 'inset')).toBe('auto 12px var(--phone-dock-bottom)');
    expect(ruleDeclaration(history, dock, 'height')).toBe('calc(var(--voice-dock-top) - var(--phone-dock-bottom))');
    expect(ruleDeclaration(history, dock, 'pointer-events')).toBe('none');
    expect(ruleDeclaration(history, dock, 'z-index')).toBe('var(--z-voice-controls)');
    expect(ruleDeclaration(history, dock, 'background')).toBe('transparent');
    expect(ruleDeclaration(history, dock, 'backdrop-filter')).toBe('none');
    expect(history).toContain('@media (width > 700px) and (not ((max-height: 500px) and (pointer: coarse))) {\n.app-shell[data-voice-active="true"]');
    expect(voice).toContain('.app-shell[data-phone="true"][data-voice-active="true"] {\n    --jarvis-orb-dock-radius:');
    expect(history).toContain('.conversation-input::after { content: none; }');
    expect(history).toContain('.workspace { height: 100%; min-height: 0; margin: 0; padding: 0; border: 0; background: transparent; box-shadow: none; backdrop-filter: none; }');
    expect(styles).toContain('.app-topbar { border-radius: 0; background: var(--stage-slab); box-shadow: none; backdrop-filter: none; }');
    expect(styles).toContain('.app-shell[data-phone="true"][data-voice-active="false"]:has(.shell-main .loader.loader-block) .jarvis-page .conversation-input,');
    const scene = readFileSync('src/jarvis-stage-scene.ts', 'utf8');
    expect(scene).toContain("getPropertyValue('--jarvis-orb-dock-radius')");
    expect(scene).toContain("getPropertyValue('--jarvis-orb-dock-bottom')");
    expect(scene).toContain('panel.position.y = mobile ? 15.7 : 7.7;');
  });

  it('keeps fallback and the compact voice bar readable over the stage on narrow screens', () => {
    const stageStyles = readFileSync('src/JarvisStage.css', 'utf8');
    const historyStyles = readFileSync('src/ConversationHistory.css', 'utf8');

    expect(ruleDeclaration(stageStyles, /\.jarvis-stage-fallback\s*\{([^}]*)\}/, 'position')).toBe('relative');
    expect(stageStyles).not.toContain('voice-orb');
    expect(historyStyles).not.toContain('voice-orb');
    expect(historyStyles).not.toContain('.composer-language');
    expect(historyStyles).toContain('@media (max-width: 380px) {\n  .voice-bar { gap: var(--space-1); padding: var(--space-2); }');
    expect(historyStyles).not.toContain('.voice-bar-status');
    expect(historyStyles).not.toContain('.voice-bar-action');
    expect(ruleDeclaration(historyStyles, /\.voice-end-control\s*\{([^}]*)\}/, 'min-height')).toBe('44px');
    const voiceInput = /\.app-shell\[data-voice-active="true"\] \.conversation-input\[data-voice-active="true"\]\s*\{([^}]*)\}/;
    expect(ruleDeclaration(historyStyles, voiceInput, 'backdrop-filter')).toBe('none');
  });

  it('defines luminous glass once as a shared surface built from canonical tokens', () => {
    const source = readFileSync('src/styles.css', 'utf8');
    const historyStyles = readFileSync('src/ConversationHistory.css', 'utf8');

    expect(tokenValue(source, ':root', '--glass-edge-cool')).toBe('var(--stage-orb)');
    expect(tokenValue(source, ':root', '--glass-edge-warm')).toBe('var(--stage-amber)');
    expect(ruleDeclaration(source, /\.luminous-glass\s*\{([^}]*)\}/, 'background')).toBe('var(--surface-translucent)');
    expect(ruleDeclaration(source, /\.luminous-glass::before\s*\{([^}]*)\}/, 'background')).toBe('var(--glass-refraction)');
    expect(ruleDeclaration(source, /\.more-menu-trigger\s*\{([^}]*)\}/, 'width')).toBe('44px');
    expect(ruleDeclaration(source, /\.more-menu-item\s*\{([^}]*)\}/, 'min-height')).toBe('44px');
    expect(historyStyles).not.toContain('.luminous-glass');
    expect(source).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.more-menu-list, \.more-menu-flyout, \.voice-status-glyph \* \{ animation: none !important; \}/u);
    expect(source).toContain(':root[data-motion="reduced"] .voice-status-glyph *');
  });

  it('keeps theme-aware stage materials in the shared semantic CSS source', () => {
    const source = readFileSync('src/styles.css', 'utf8');

    for (const token of ['--stage-background', '--stage-floor', '--stage-wall', '--stage-inset',
      '--stage-metal', '--stage-seam', '--stage-amber', '--stage-hemisphere', '--stage-ground',
      '--stage-key', '--stage-rim', '--stage-orb', '--stage-reflector', '--stage-exposure']) {
      expect(tokenValue(source, ':root', token)).toBeTruthy();
      expect(tokenValue(source, ':root\\[data-theme="dark"\\]', token)).toBeTruthy();
    }
  });

  it('uses the orange and stone palette without changing the cyan orb or listening states', () => {
    const source = readFileSync('src/styles.css', 'utf8');
    const dark = ':root\\[data-theme="dark"\\]';

    expect(tokenValue(source, ':root', '--focus')).toBe('#a65300');
    expect(tokenValue(source, dark, '--focus')).toBe('#ffb45c');
    expect(tokenValue(source, ':root', '--primary-action')).toBe('var(--theme-accent, #b45f06)');
    expect(tokenValue(source, dark, '--primary-action')).toBe('var(--theme-accent, #ffb45c)');
    expect(tokenValue(source, ':root', '--primary-action-text')).toBe('var(--theme-accent-foreground, #ffffff)');
    expect(tokenValue(source, dark, '--primary-action-text')).toBe('var(--theme-accent-foreground, #1d1200)');
    expect(tokenValue(source, ':root', '--secondary-accent')).toBe('#6f6551');
    expect(tokenValue(source, dark, '--secondary-accent')).toBe('#c9bfae');
    expect(tokenValue(source, ':root', '--state-listening')).toBe('#14768d');
    expect(tokenValue(source, dark, '--state-listening')).toBe('#52dcfa');
    expect(tokenValue(source, ':root', '--stage-seam')).toBe('var(--theme-accent-secondary, #14768d)');
    expect(tokenValue(source, dark, '--stage-seam')).toBe('var(--theme-accent-secondary, #52c7dc)');
    expect(tokenValue(source, ':root', '--stage-rim')).toBe('var(--theme-accent-secondary, #388da0)');
    expect(tokenValue(source, dark, '--stage-rim')).toBe('var(--theme-accent-secondary, #55bace)');
    expect(tokenValue(source, ':root', '--stage-orb')).toBe('var(--theme-accent, #14768d)');
    expect(tokenValue(source, dark, '--stage-orb')).toBe('var(--theme-accent, #52dcfa)');
    expect(tokenValue(source, ':root', '--glass-edge-cool')).toBe('var(--stage-orb)');
  });

  it('removes the bottom shell bar and shares subtle selection without outlined slabs', () => {
    const source = readFileSync('src/styles.css', 'utf8');
    const historyStyles = readFileSync('src/ConversationHistory.css', 'utf8');

    expect(source).not.toContain('.bottom-bar');
    expect(historyStyles).not.toContain('.bottom-bar');
    expect(ruleDeclaration(source, /\.app-shell\s*\{([^}]*)\}/, 'grid-template-rows')).toBe('var(--rail-size) minmax(0, 1fr)');
    expect(ruleDeclaration(source, /\.rail-link\[aria-current="page"\] svg\s*\{([^}]*)\}/, 'stroke-width')).toBe('2.1');
    for (const selector of [
      /\.rail-link\[aria-current="page"\]\s*\{([^}]*)\}/,
      /\.sidebar-link\[aria-current="page"\]\s*\{([^}]*)\}/,
      /\.camera-control-button\[aria-pressed="true"\], \.topbar-icon-button\[aria-expanded="true"\], \.settings-link\[aria-current="page"\]\s*\{([^}]*)\}/,
      /\.workspace-arrangement-options \[aria-pressed="true"\]\s*\{([^}]*)\}/,
      /\.workspaces-kind\[aria-pressed="true"\]\s*\{([^}]*)\}/,
      /\.usage-segmented button\[aria-pressed="true"\]\s*\{([^}]*)\}/,
      /\.advanced-segmented button\[aria-pressed="true"\]\s*\{([^}]*)\}/,
    ]) {
      expect(ruleDeclaration(source, selector, 'background')).toBe('var(--state-selected-bg)');
      expect(ruleDeclaration(source, selector, 'color')).toBe('var(--state-selected-fg)');
      expect(ruleDeclaration(source, selector, 'box-shadow')).toBe('none');
    }
    expect(ruleDeclaration(source, /\.presence-chip-trigger\[aria-expanded="true"\]\s*\{([^}]*)\}/, 'background')).toBe('var(--state-selected-bg)');
    expect(ruleDeclaration(source, /\.workspace-tab-item\[data-state="front"\]\s*\{([^}]*)\}/, 'background')).toBe('var(--state-selected-bg)');
    expect(ruleDeclaration(source, /\.mobile-menu-link\[aria-current="page"\]\s*\{([^}]*)\}/, 'font-weight')).toBe('750');
    expect(ruleDeclaration(source, /\.mobile-menu-link\[aria-current="page"\]\s*\{([^}]*)\}/, 'background')).toBe('transparent');
    expect(ruleDeclaration(source, /\.mobile-menu-link\[aria-current="page"\]\s*\{([^}]*)\}/, 'color')).toBe('var(--focus)');
    expect(ruleDeclaration(source, /\.mobile-bottom-nav-link:is\(\[aria-current="page"\], \[aria-pressed="true"\], \[aria-expanded="true"\]\) svg\s*\{([^}]*)\}/, 'color')).toBe('var(--focus)');
    expect(ruleDeclaration(source, /\.mobile-bottom-nav-link\s*\{([^}]*)\}/, 'background')).toBe('transparent');
    expect(ruleDeclaration(source, /\.mobile-bottom-nav-link\s*\{([^}]*)\}/, 'border')).toBe('0');
    expect(source).not.toMatch(/\.mobile-bottom-nav-link:(?:hover|active)\s*\{/);
    expect(ruleDeclaration(source, /\.mobile-bottom-nav-link:focus-visible\s*\{([^}]*)\}/, 'outline')).toBe('3px solid var(--focus)');
    expect(source.indexOf('.mobile-bottom-nav-link:is([aria-current="page"]'))
      .toBeGreaterThan(source.indexOf('.mobile-bottom-nav-link:hover'));
    expect(source).toContain('--selection-hover: var(--state-selected-hover)');
    expect(source).toContain('--selection-pressed: var(--state-selected-pressed)');
    expect(source).toContain('background: var(--selection-pressed, var(--glass-pressed))');
    expect(source).toContain('@media (hover: hover)');
    expect(source).toMatch(/\.app-shell :is\(\.rail-link,[^{}]+\):active:not\(:disabled\) \{\s*background: var\(--selection-pressed, var\(--glass-pressed\)\);/);
    expect(source).toMatch(/@media \(hover: hover\) \{\s*\.app-shell :is\(\.rail-link,[^{}]+\):hover:not\(:disabled\)/);
    expect(source).toContain('@media (pointer: coarse) { .presence-chip-trigger { min-width: 44px; min-height: 44px; justify-content: center; } }');
  });

  it('uses orange for selected rail icons and floats their names flat beside them', () => {
    const source = readFileSync('src/styles.css', 'utf8');
    const link = ruleDeclaration(source, /\n\.rail-link\s*\{([^}]*)\}/, '--state-selected-bg');
    expect(link).toBe('color-mix(in srgb, var(--rail-tone) 16%, transparent)');
    expect(ruleDeclaration(source, /\n\.rail-link\s*\{([^}]*)\}/, '--state-selected-fg')).toBe('var(--rail-tone)');
    expect(ruleDeclaration(source, /\n\.rail-link\s*\{([^}]*)\}/, '--rail-tone')).toBe('var(--focus)');
    expect(source).not.toContain('--rail-tone-home');
    expect(tokenValue(source, ':root', '--state-selected-bg')).not.toContain('--rail-tone');

    const tip = /\n\.rail-tip\s*\{([^}]*)\}/;
    expect(ruleDeclaration(source, tip, 'position')).toBe('fixed');
    expect(ruleDeclaration(source, tip, 'z-index')).toBe('var(--z-menu)');
    expect(source.match(tip)?.[1]).not.toMatch(/(^|\s)transform:/);
    expect(source).toContain('.rail-tip[data-open="true"] { opacity: 1; visibility: visible; pointer-events: auto;');
    expect(source).toContain(':root[data-motion="reduced"] .rail-tip { translate: 0 -50%; transition: none; }');
    expect(source).toContain('@media (prefers-reduced-motion: reduce) { .rail-tip { translate: 0 -50%; transition: none; } }');
  });

  it('keeps sibling controls on one size scale', () => {
    const source = readFileSync('src/styles.css', 'utf8');
    const notes = readFileSync('src/notes/NotesArea.css', 'utf8');
    expect(tokenValue(source, ':root', '--control-size')).toBe('44px');
    expect(tokenValue(source, ':root', '--control-size-inset')).toBe('36px');
    expect(tokenValue(source, ':root', '--pill-size')).toBe('28px');
    const search = ruleDeclaration(source, /\n\.knowledge-search\s*\{([^}]*)\}/, 'height');
    expect(search).toBe('var(--control-size)');
    expect(ruleDeclaration(source, /\n\.knowledge-search\s*\{([^}]*)\}/, 'padding')).toBe('0 var(--space-1) 0 var(--space-4)');
    expect(ruleDeclaration(notes, /\.notes-page \.knowledge-search \.notes-create-button\s*\{([^}]*)\}/, 'min-height')).toBe('var(--control-size-inset)');
    expect(ruleDeclaration(notes, /\.notes-page \.notes-tasks-toggle\s*\{([^}]*)\}/, 'min-height')).toBe('var(--control-size)');
    expect(ruleDeclaration(notes, /\.notes-page \.notes-tree-toggle\s*\{([^}]*)\}/, 'min-height')).toBe('var(--control-size)');
    expect(ruleDeclaration(notes, /\.notes-page \.notes-tree-toggle\s*\{([^}]*)\}/, 'width')).toBe('var(--control-size)');
    expect(ruleDeclaration(source, /\n\.knowledge-reset\s*\{([^}]*)\}/, 'min-height')).toBe('var(--control-size-inset)');
    expect(ruleDeclaration(source, /\.topbar-feature-button, \.settings-link, \.topbar-icon-button\s*\{([^}]*)\}/, 'height')).toBe('var(--control-size)');
    expect(notes).not.toMatch(/\.notes-page \.knowledge-reset\s*\{\s*min-height: 44px/);
  });

  it('keeps selected text at 4.5:1 and indicators at 3:1 in both themes and interaction states', () => {
    const source = readFileSync('src/styles.css', 'utf8');
    expect(tokenValue(source, ':root', '--state-selected-fg')).toBe('color-mix(in srgb, var(--focus) 40%, var(--text))');
    expect(tokenValue(source, ':root', '--state-selected-indicator')).toBe('var(--state-selected-fg)');
    for (const selector of [':root', ':root\\[data-theme="dark"\\]']) {
      const focus = parseColor(tokenValue(source, selector, '--focus')).color;
      const text = parseColor(tokenValue(source, selector, '--text')).color;
      const selected = composite(focus, .4, text);
      for (const name of ['--page', '--surface', '--surface-muted', '--surface-translucent', '--stage-background', '--stage-floor']) {
        const surface = parseColor(tokenValue(source, selector, name));
        for (const backdrop of [[0, 0, 0], [255, 255, 255]] as Color[]) {
          const rendered = composite(surface.color, surface.alpha, backdrop);
          for (const token of ['--state-selected-bg', '--state-selected-hover', '--state-selected-pressed']) {
            const value = tokenValue(source, ':root', token);
            expect(value).toMatch(/^color-mix\(in srgb, var\(--state-selected-indicator\) \d+%, transparent\)$/);
            const alpha = Number(value.match(/(\d+)%/)![1]) / 100;
            const background = composite(selected, alpha, rendered);
            expect(contrast(selected, background), `${selector} ${name} ${token}`).toBeGreaterThanOrEqual(4.5);
            expect(contrast(selected, background)).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });

  it('shows presence as green, yellow and blue and holds 3:1 on every surface in both themes', () => {
    const source = readFileSync('src/styles.css', 'utf8');
    const hueRanges = { '--presence-present': [90, 160], '--presence-away': [40, 65], '--presence-move': [200, 250] } as const;
    const surfaces = ['--page', '--surface', '--surface-muted', '--surface-translucent', '--stage-background', '--stage-floor'];
    // Dark dots are solid. Light dots keep their hue and rely on a ring of 55% of that hue, so the ring is what holds 3:1.
    const themes = [
      { name: 'dark', tokens: source.match(/:root, :root\[data-theme="dark"\] \{([^}]*--presence-present[^}]*)\}/)?.[1], surfaces: ':root\\[data-theme="dark"\\]', ring: 1 },
      { name: 'light', tokens: source.match(/:root\[data-theme="light"\] \{([^}]*--presence-present[^}]*)\}/)?.[1], surfaces: ':root', ring: 0.55 },
    ];
    expect(source).toContain(':root[data-theme="light"] .presence-dot { --presence-ring: color-mix(in srgb, var(--tone) 55%, var(--ink-solid)); }');

    for (const { name, tokens, surfaces: selector, ring } of themes) {
      expect(tokens, `${name} presence tokens`).toBeDefined();
      for (const [token, [low, high]] of Object.entries(hueRanges)) {
        const fill = parseColor(tokens!.match(new RegExp(`${token}:\\s*([^;]+);`))![1]!.trim()).color;
        expect(hue(fill), `${name} ${token} hue`).toBeGreaterThanOrEqual(low);
        expect(hue(fill), `${name} ${token} hue`).toBeLessThanOrEqual(high);
        const indicator = fill.map((channel) => channel * ring) as Color;
        for (const surfaceName of surfaces) {
          const surface = parseColor(tokenValue(source, selector, surfaceName));
          for (const backdrop of [[0, 0, 0], [255, 255, 255]] as Color[]) {
            expect(contrast(indicator, composite(surface.color, surface.alpha, backdrop)), `${name} ${token} on ${surfaceName}`)
              .toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });
});
