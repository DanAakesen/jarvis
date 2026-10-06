import type { ResolvedTheme } from './theme-preference-context';

export interface HtmlAppEnvironment {
  readonly theme: ResolvedTheme;
  readonly tokens: Readonly<Record<string, string>>;
}

export type HtmlAppBridgeMessage =
  | { type: 'open_url'; url: string }
  | { type: 'ask'; text: string }
  | { type: 'pin' | 'unpin' }
  | { type: 'resize'; height: number };

const maximumFrameHeight = 1_200;
const minimumFrameHeight = 120;
const tokenNames = [
  '--page', '--surface', '--surface-muted', '--text', '--text-muted',
  '--primary-action', '--font-body', '--font-heading', '--line-body', '--radius-control',
];
const tokenFallbacks: Readonly<Record<string, string>> = {
  '--page': '#f6f0e6',
  '--surface': '#fffaf1',
  '--surface-muted': '#e2eaed',
  '--text': '#17202a',
  '--text-muted': '#5c564f',
  '--primary-action': '#276d6f',
  '--font-body': 'system-ui, sans-serif',
  '--font-heading': 'system-ui, sans-serif',
  '--line-body': '1.55',
  '--radius-control': '10px',
};
const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; navigate-to 'none'";

function safeToken(value: string, fallback: string): string {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 128 && !/[<>;{}\\]/u.test(normalized)
    ? normalized
    : fallback;
}

export function readHtmlAppEnvironment(theme: ResolvedTheme): HtmlAppEnvironment {
  const computed = getComputedStyle(document.documentElement);
  const tokens = Object.fromEntries(tokenNames.map((name) => [
    name,
    safeToken(computed.getPropertyValue(name), tokenFallbacks[name]!),
  ]));
  return { theme, tokens };
}

export function createHtmlAppDocument(html: string, environment: HtmlAppEnvironment, channel: string): string {
  const tokens = Object.fromEntries(tokenNames.map((name) => [
    name,
    safeToken(environment.tokens[name] ?? '', tokenFallbacks[name]!),
  ]));
  const style = `:root{color-scheme:${environment.theme};${Object.entries(tokens).map(([name, value]) =>
    `--jarvis-${name.slice(2)}:${value}`).join(';')}}*{box-sizing:border-box}html,body{min-width:0;min-height:100%;margin:0}body{padding:16px;background:var(--jarvis-page);color:var(--jarvis-text);font:16px/${tokens['--line-body']} ${tokens['--font-body']};overflow-wrap:anywhere}h1,h2,h3{font-family:${tokens['--font-heading']}}a{color:var(--jarvis-primary-action)}:focus-visible{outline:3px solid var(--jarvis-primary-action);outline-offset:2px}@media(max-width:480px){body{padding:12px}}`;
  const bridge = `(function(){'use strict';const channel=${JSON.stringify(channel)};const send=(type,payload={})=>window.parent.postMessage({type,channel,...payload},'*');const active=()=>navigator.userActivation?.isActive===true;const validUrl=value=>{if(typeof value!=='string'||value.length>2048||value!==value.trim())return false;try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password}catch{return false}};Object.defineProperty(window,'jarvis',{value:Object.freeze({openUrl(url){if(!active()||!validUrl(url))return false;send('open_url',{url});return true},ask(text){if(!active()||typeof text!=='string'||!text.trim()||text.length>2000)return false;send('ask',{text});return true},pin(){if(!active())return false;send('pin');return true},unpin(){if(!active())return false;send('unpin');return true},resize(height){if(typeof height!=='number'||!Number.isFinite(height)||height<${minimumFrameHeight}||height>${maximumFrameHeight})return false;send('resize',{height});return true}}),configurable:false,writable:false});const report=()=>send('resize',{height:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0)});if(window.ResizeObserver){const observer=new ResizeObserver(report);observer.observe(document.documentElement);if(document.body)observer.observe(document.body)}window.addEventListener('load',report,{once:true});document.addEventListener('DOMContentLoaded',report,{once:true});requestAnimationFrame(report)})();`;
  return `<!doctype html><html lang="en"><head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style><script>${bridge}</script></head><body>${html}</body></html>`;
}

export function validateHtmlAppBridgeMessage(value: unknown, channel: string): HtmlAppBridgeMessage | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (message.channel !== channel || typeof message.type !== 'string') return null;
  switch (message.type) {
    case 'open_url': {
      if (Object.keys(message).some((key) => !['type', 'channel', 'url'].includes(key)) ||
          typeof message.url !== 'string' || message.url.length > 2_048 || message.url !== message.url.trim()) return null;
      try {
        const url = new URL(message.url);
        return url.protocol === 'https:' && !url.username && !url.password
          ? { type: 'open_url', url: message.url }
          : null;
      } catch {
        return null;
      }
    }
    case 'ask':
      return Object.keys(message).length === 3 && Object.keys(message).every((key) =>
        ['type', 'channel', 'text'].includes(key)) &&
        typeof message.text === 'string' && message.text.trim().length > 0 && message.text.length <= 2_000
        ? { type: 'ask', text: message.text }
        : null;
    case 'pin':
    case 'unpin':
      return Object.keys(message).length === 2 && Object.keys(message).every((key) =>
        ['type', 'channel'].includes(key))
        ? { type: message.type }
        : null;
    case 'resize':
      return Object.keys(message).length === 3 && Object.keys(message).every((key) =>
        ['type', 'channel', 'height'].includes(key)) &&
        typeof message.height === 'number' && Number.isFinite(message.height) &&
        message.height >= minimumFrameHeight && message.height <= maximumFrameHeight
        ? { type: 'resize', height: message.height }
        : null;
    default:
      return null;
  }
}
