import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Color = [number, number, number];

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

describe('shared glass tokens', () => {
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
    expect(styles).toContain('@media (max-width: 700px), (max-height: 500px) and (pointer: coarse) {\n  :root { --phone-dock-bottom: calc(env(safe-area-inset-bottom) + 16px); }');
    expect(ruleDeclaration(styles, /\.app-shell\.app-signed-out\s*\{([^}]*)\}/, 'padding')).toBe('env(safe-area-inset-top) calc(env(safe-area-inset-right) + 20px) env(safe-area-inset-bottom) calc(env(safe-area-inset-left) + 20px)');
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
    const appSource = readFileSync('src/App.tsx', 'utf8');
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

    expect(shellIconColor).toBe('var(--text-muted)');
    expect(sidebarTextColor).toBe('var(--text-muted)');
    expect(topbarTextColor).toBe('var(--text-muted)');
    expect(appSource).toContain("stroke: 'currentColor'");

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

  it('uses the accepted sans typography for shared headings', () => {
    const source = readFileSync('src/styles.css', 'utf8');

    expect(tokenValue(source, ':root', '--font-heading')).toBe('var(--font-body)');
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
    expect(styles).toContain('padding: clamp(16px, 12vh, 100px) 12px');
    expect(styles).toContain('@media (max-width: 600px)');
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

  it('bounds phone voice to a transparent non-intercepting dock and keeps fullscreen rules desktop-only', () => {
    const history = readFileSync('src/ConversationHistory.css', 'utf8');
    const voice = readFileSync('src/VoiceControls.css', 'utf8');
    const styles = readFileSync('src/styles.css', 'utf8');
    const dock = /\.app-shell\[data-phone="true"\]\[data-voice-active="true"\] \.voice-controls\[data-active="true"\]\s*\{([^}]*)\}/;
    expect(ruleDeclaration(history, dock, 'inset')).toBe('auto 12px var(--phone-dock-bottom)');
    expect(ruleDeclaration(history, dock, 'height')).toBe('calc(var(--voice-dock-top) - var(--phone-dock-bottom))');
    expect(ruleDeclaration(history, dock, 'pointer-events')).toBe('none');
    expect(ruleDeclaration(history, dock, 'z-index')).toBe('43');
    expect(ruleDeclaration(history, dock, 'background')).toBe('transparent');
    expect(ruleDeclaration(history, dock, 'backdrop-filter')).toBe('none');
    expect(history).toContain('@media (min-width: 701px) and (not ((max-height: 500px) and (pointer: coarse))) {\n.app-shell[data-voice-active="true"]');
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
    expect(historyStyles).toContain('@media (max-width: 360px) {\n  .voice-bar { gap: 4px; padding: 6px; }');
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
      /\.mobile-menu-link\[aria-current="page"\]\s*\{([^}]*)\}/,
      /\.camera-control-button\[aria-pressed="true"\], \.topbar-icon-button\[aria-expanded="true"\], \.settings-link\[aria-current="page"\]\s*\{([^}]*)\}/,
      /\.workspace-view-switcher \.workspace-tab\[aria-current="true"\]\s*\{([^}]*)\}/,
      /\.workspace-arrangement-options \[aria-pressed="true"\]\s*\{([^}]*)\}/,
      /\.folio-kind\[aria-pressed="true"\]\s*\{([^}]*)\}/,
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
    expect(source).toContain('--selection-hover: var(--state-selected-hover)');
    expect(source).toContain('--selection-pressed: var(--state-selected-pressed)');
    expect(source).toContain('background: var(--selection-pressed, var(--glass-pressed))');
    expect(source).toContain('@media (hover: hover)');
    expect(source).toMatch(/\.app-shell :is\(\.rail-link,[^{}]+\):active:not\(:disabled\) \{\s*background: var\(--selection-pressed, var\(--glass-pressed\)\);/);
    expect(source).toMatch(/@media \(hover: hover\) \{\s*\.app-shell :is\(\.rail-link,[^{}]+\):hover:not\(:disabled\)/);
    expect(source).toContain('@media (pointer: coarse) { .presence-chip-trigger { min-width: 44px; min-height: 44px; justify-content: center; } }');
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
});
