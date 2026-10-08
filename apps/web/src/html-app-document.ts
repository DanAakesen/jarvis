import { isHtmlArtifact, type HtmlArtifact } from '@jarvis/contracts';

// Sandboxed HTML apps and research reports (P8-41, #429). Model-written HTML runs only inside an iframe with
// sandbox="allow-scripts" (no same-origin, forms, popups or navigation), loaded from srcdoc with this CSP, which
// also blocks all network access. The page talks to Jarvis only through the bridge messages validated below.

export const htmlAppCsp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";

export const maxAskLength = 2_000;
export const minAppHeight = 160;
export const maxAppHeight = 20_000;

export type HtmlAppMessage =
  | { type: 'open_url'; url: string }
  | { type: 'ask'; text: string }
  | { type: 'pin' }
  | { type: 'unpin' }
  | { type: 'resize'; height: number };

/** The `jarvis` object inside the frame: link clicks, questions, pinning and auto-height all go through postMessage. */
const bridgeScript = `(function () {
  var post = function (message) { message.jarvisBridge = 1; parent.postMessage(message, '*'); };
  window.jarvis = Object.freeze({
    openUrl: function (url) { post({ type: 'open_url', url: String(url) }); },
    ask: function (text) { post({ type: 'ask', text: String(text).slice(0, ${maxAskLength}) }); },
    pin: function () { post({ type: 'pin' }); },
    unpin: function () { post({ type: 'unpin' }); },
    resize: function (height) { post({ type: 'resize', height: Number(height) }); }
  });
  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link) return;
    var href = link.getAttribute('href') || '';
    if (href.charAt(0) === '#') return;
    event.preventDefault();
    if (/^https:\\/\\//i.test(link.href)) window.jarvis.openUrl(link.href);
  });
  var lastHeight = 0;
  var report = function () {
    // scrollHeight never drops below the frame itself, so measure the content to let short apps shrink.
    var root = document.documentElement.getBoundingClientRect().height;
    var body = document.body ? document.body.getBoundingClientRect().bottom + window.scrollY : 0;
    var height = Math.ceil(Math.max(root, body));
    if (Math.abs(height - lastHeight) < 2) return;
    lastHeight = height;
    post({ type: 'resize', height: height });
  };
  addEventListener('load', report);
  if (typeof ResizeObserver === 'function') new ResizeObserver(report).observe(document.documentElement);
  setTimeout(report, 0);
})();`;

function escapeStyleValue(value: string) {
  return value.replace(/[<>{};]/gu, '').slice(0, 300);
}

/** Builds the frame document: CSP first, then theme variables and the bridge, then the app's own head. */
export function htmlAppDocument(html: string, theme: { scheme: 'dark' | 'light'; tokens: Record<string, string> }) {
  const variables = Object.entries(theme.tokens)
    .filter(([name, value]) => /^--[a-z0-9-]{1,40}$/u.test(name) && value.trim())
    .map(([name, value]) => `--jarvis-${name.slice(2)}: ${escapeStyleValue(value.trim())};`)
    .join(' ');
  const injected = `<meta http-equiv="Content-Security-Policy" content="${htmlAppCsp}">`
    + `<meta name="referrer" content="no-referrer">`
    + `<style>:root { color-scheme: ${theme.scheme}; ${variables} }</style>`
    + `<script>${bridgeScript}</script>`;
  // A meta CSP only governs what follows it, so it goes before anything the app wrote (after the doctype, which keeps
  // standards mode); the parser files these elements into the head it creates.
  const doctype = /^\s*<!doctype[^>]*>/iu.exec(html);
  if (doctype) return doctype[0] + injected + html.slice(doctype[0].length);
  return injected + html;
}

/** Accepts only the bridge's message shapes, bounded; everything else is ignored. */
export function readHtmlAppMessage(value: unknown): HtmlAppMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const message = value as Record<string, unknown>;
  if (message.jarvisBridge !== 1) return null;
  switch (message.type) {
    case 'open_url': {
      if (typeof message.url !== 'string' || message.url.length > 2_048) return null;
      try {
        const url = new URL(message.url);
        return url.protocol === 'https:' && !url.username && !url.password ? { type: 'open_url', url: url.href } : null;
      } catch {
        return null;
      }
    }
    case 'ask': {
      const text = typeof message.text === 'string' ? message.text.trim() : '';
      return text && text.length <= maxAskLength ? { type: 'ask', text } : null;
    }
    case 'pin':
    case 'unpin':
      return { type: message.type };
    case 'resize':
      return typeof message.height === 'number' && Number.isFinite(message.height)
        ? { type: 'resize', height: Math.min(maxAppHeight, Math.max(minAppHeight, Math.round(message.height))) }
        : null;
    default:
      return null;
  }
}

export function readHtmlArtifact(value: unknown): HtmlArtifact | null {
  return isHtmlArtifact(value) ? value : null;
}
