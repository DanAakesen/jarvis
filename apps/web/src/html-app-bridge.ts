import type { ResolvedTheme } from './theme-preference-context';
import type { HtmlAppFrame } from '@jarvis/contracts';

export interface HtmlAppEnvironment {
  readonly theme: ResolvedTheme;
  readonly tokens: Readonly<Record<string, string>>;
  readonly density: HtmlAppFrame['density'];
  readonly fonts: HtmlAppFrame['fonts'];
}

export type HtmlAppBridgeMessage =
  | { type: 'open_url'; url: string }
  | { type: 'ask'; text: string }
  | { type: 'pin' | 'unpin' }
  | { type: 'resize'; height: number }
  | { type: 'frame_report'; status: 'ok'; scrollHeight: number; overflowX: boolean }
  | { type: 'frame_report'; status: 'error'; error: string; scrollHeight: number; overflowX: boolean };

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
const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'";

function safeToken(value: string, fallback: string): string {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 128 && !/[<>;{}\\]/u.test(normalized)
    ? normalized
    : fallback;
}

export function readHtmlAppEnvironment(
  theme: ResolvedTheme,
  densityPreference?: HtmlAppFrame['density'],
): HtmlAppEnvironment {
  const computed = getComputedStyle(document.documentElement);
  const tokens = Object.fromEntries(tokenNames.map((name) => [
    name,
    safeToken(computed.getPropertyValue(name), tokenFallbacks[name]!),
  ]));
  const densityScale = Number.parseFloat(computed.getPropertyValue('--theme-density-scale'));
  return {
    theme,
    tokens,
    density: densityPreference ??
      (Number.isFinite(densityScale) && densityScale < 1 ? 'compact' : 'comfortable'),
    fonts: {
      body: tokens['--font-body']!,
      heading: tokens['--font-heading']!,
    },
  };
}

export function createHtmlAppDocument(html: string, environment: HtmlAppEnvironment, channel: string): string {
  const tokens = Object.fromEntries(tokenNames.map((name) => [
    name,
    safeToken(environment.tokens[name] ?? '', tokenFallbacks[name]!),
  ]));
  const style = `:root{color-scheme:${environment.theme};${Object.entries(tokens).map(([name, value]) =>
    `--jarvis-${name.slice(2)}:${value}`).join(';')}}*{box-sizing:border-box}html,body{min-width:0;min-height:100%;margin:0}body{padding:16px;background:var(--jarvis-page);color:var(--jarvis-text);font:16px/${tokens['--line-body']} ${tokens['--font-body']};overflow-wrap:anywhere}h1,h2,h3{font-family:${tokens['--font-heading']}}a{color:var(--jarvis-primary-action)}:focus-visible{outline:3px solid var(--jarvis-primary-action);outline-offset:2px}@media(max-width:480px){body{padding:12px}}`;
  const bridge = `(function(){'use strict';const channel=${JSON.stringify(channel)};const send=(type,payload={})=>window.parent.postMessage({type,channel,...payload},'*');const active=()=>navigator.userActivation?.isActive===true;const validUrl=value=>{if(typeof value!=='string'||value.length>2048||value!==value.trim())return false;try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password}catch{return false}};let currentFrame=null;const frameListeners=new Set();const validFrame=frame=>frame&&typeof frame==='object'&&!Array.isArray(frame)&&Number.isInteger(frame.widthPx)&&frame.widthPx>0&&frame.widthPx<=10000&&Number.isInteger(frame.heightPx)&&frame.heightPx>0&&frame.heightPx<=10000&&(frame.device==='desktop'||frame.device==='phone')&&(frame.theme==='dark'||frame.theme==='light')&&typeof frame.reducedMotion==='boolean'&&(frame.density==='compact'||frame.density==='comfortable')&&(frame.layout==='tiled'||frame.layout==='layered')&&typeof frame.pinned==='boolean'&&frame.designTokens&&typeof frame.designTokens==='object'&&!Array.isArray(frame.designTokens)&&Object.keys(frame.designTokens).length<=32&&Object.entries(frame.designTokens).every(([key,value])=>/^--[a-z0-9-]{1,80}$/u.test(key)&&typeof value==='string'&&value.length<=128)&&frame.fonts&&typeof frame.fonts==='object'&&!Array.isArray(frame.fonts)&&Object.keys(frame.fonts).length===2&&typeof frame.fonts.body==='string'&&frame.fonts.body.length<=128&&typeof frame.fonts.heading==='string'&&frame.fonts.heading.length<=128;const applyFrame=frame=>{currentFrame=frame;document.documentElement.dataset.theme=frame.theme;document.documentElement.style.colorScheme=frame.theme;document.documentElement.dataset.reducedMotion=String(frame.reducedMotion);for(const [name,value] of Object.entries(frame.designTokens))document.documentElement.style.setProperty('--jarvis-'+name.slice(2),value);document.body.style.fontFamily=frame.fonts.body;for(const heading of document.querySelectorAll('h1,h2,h3'))heading.style.fontFamily=frame.fonts.heading;for(const listener of frameListeners)try{listener(frame)}catch{}};window.addEventListener('message',event=>{const message=event.data;if(event.source!==window.parent||!message||message.type!=='frame'||message.channel!==channel||!validFrame(message.frame))return;applyFrame(message.frame)});const onFrame=callback=>{if(typeof callback!=='function')return()=>{};frameListeners.add(callback);if(currentFrame)try{callback(currentFrame)}catch{}return()=>frameListeners.delete(callback)};Object.defineProperty(window,'jarvis',{value:Object.freeze({onFrame,openUrl(url){if(!active()||!validUrl(url))return false;send('open_url',{url});return true},ask(text){if(!active()||typeof text!=='string'||!text.trim()||text.length>2000)return false;send('ask',{text});return true},pin(){if(!active())return false;send('pin');return true},unpin(){if(!active())return false;send('unpin');return true},resize(height){if(typeof height!=='number'||!Number.isFinite(height)||height<${minimumFrameHeight}||height>${maximumFrameHeight})return false;send('resize',{height});return true}}),configurable:false,writable:false});const dimensions=()=>{const root=document.documentElement;const body=document.body;const height=Math.max(root.scrollHeight,body?.scrollHeight||0);const width=Math.max(root.scrollWidth,body?.scrollWidth||0);return{height,overflowX:width>window.innerWidth+1}};const report=()=>{const result=dimensions();send('resize',{height:result.height});send('frame_report',{status:'ok',scrollHeight:result.height,overflowX:result.overflowX})};const reportError=message=>{const result=dimensions();const error=String(message||'HTML app runtime error').replace(/[\\u0000-\\u001f\\u007f]/gu,' ').slice(0,500);send('frame_report',{status:'error',error,scrollHeight:result.height,overflowX:result.overflowX})};window.addEventListener('error',event=>reportError(event.message));window.addEventListener('unhandledrejection',event=>reportError(event.reason instanceof Error?event.reason.message:event.reason));if(window.ResizeObserver){const observer=new ResizeObserver(report);observer.observe(document.documentElement);if(document.body)observer.observe(document.body)}window.addEventListener('load',report,{once:true});document.addEventListener('DOMContentLoaded',report,{once:true});requestAnimationFrame(report)})();`;
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
    case 'frame_report': {
      const keys = message.status === 'ok'
        ? ['type', 'channel', 'status', 'scrollHeight', 'overflowX']
        : ['type', 'channel', 'status', 'error', 'scrollHeight', 'overflowX'];
      if (Object.keys(message).length !== keys.length || Object.keys(message).some((key) => !keys.includes(key)) ||
          (message.status !== 'ok' && message.status !== 'error') ||
          typeof message.scrollHeight !== 'number' || !Number.isFinite(message.scrollHeight) ||
          message.scrollHeight < 0 || message.scrollHeight > 100_000 || typeof message.overflowX !== 'boolean') return null;
      if (message.status === 'ok') return { type: 'frame_report', status: 'ok', scrollHeight: message.scrollHeight, overflowX: message.overflowX };
      return typeof message.error === 'string' && message.error.length > 0 && message.error.length <= 500
        ? { type: 'frame_report', status: 'error', error: message.error, scrollHeight: message.scrollHeight, overflowX: message.overflowX }
        : null;
    }
    default:
      return null;
  }
}
