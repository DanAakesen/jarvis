import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type WebSocket from 'ws';
import type { PcBridgeConnection } from '../../../pc-bridge/bridge.js';

/**
 * Dan's Windows PC as the backend sees it: the .NET bridge and the Jarvis Chrome extension behind one WebSocket. The fake speaks
 * the real wire protocol (`{id, type:'command', command, arguments}` in, `{id, type:'result'|'error', ...}` out) through an
 * in-process socket that implements the part of the `ws` API `PcBridgeConnection` uses, so the production connection, the
 * reply validators and every tool run unchanged. Replies follow the shapes of the .NET bridge (pc-bridge/Jarvis.PcBridge*).
 *
 * The fake is stateful (apps open and close, tabs open, the clipboard changes) but keeps one snapshot per app and per tab, so a
 * case never depends on which tool ran before it.
 */

type Args = Record<string, unknown>;
type Result = Record<string, unknown>;

/** Mirrors the bridge's `CommandRefusedException(code)`: the wire answer is `{type:'error', error: code}`. */
class Refused extends Error {
  constructor(readonly code: string) { super(code); }
}

/** How the PC behaves. `healthy` answers; the others reproduce what a real PC does when it goes wrong mid-command. */
export type PcMode = 'healthy' | 'silent' | 'drops' | 'failing' | 'garbled';

export interface DesktopApp {
  readonly application: string;
  readonly display: string;
  readonly title: string;
  readonly controls: readonly (readonly [role: string, name: string])[];
}

export interface ChromeTab {
  id: string;
  title: string;
  url: string;
  focused: boolean;
  readonly elements: readonly (readonly [role: string, name: string, value: string])[];
}

const installed: readonly DesktopApp[] = [
  { application: 'vscode', display: 'Visual Studio Code', title: 'Visual Studio Code',
    controls: [['button', 'Run'], ['edit', 'Search'], ['tab', 'bridge.ts'], ['menuitem', 'File']] },
  { application: 'vscodeinsiders', display: 'Visual Studio Code - Insiders', title: 'Visual Studio Code - Insiders',
    controls: [['button', 'Run'], ['edit', 'Search'], ['tab', 'index.ts'], ['menuitem', 'File']] },
  { application: 'spotify', display: 'Spotify', title: 'Spotify',
    controls: [['button', 'Play'], ['button', 'Next'], ['edit', 'Search'], ['listitem', 'Liked Songs']] },
  { application: 'notepad', display: 'Notepad', title: 'Untitled - Notepad',
    controls: [['edit', 'Text editor'], ['menuitem', 'File'], ['menuitem', 'Edit']] },
  { application: 'codex', display: 'Codex', title: 'Codex',
    controls: [['edit', 'Prompt'], ['button', 'Send'], ['button', 'New chat']] },
  { application: 'explorer', display: 'File Explorer', title: 'Repo - File Explorer',
    controls: [['treeitem', 'jarvis'], ['listitem', 'README.md'], ['button', 'Back']] },
  { application: 'chrome', display: 'Google Chrome', title: 'Jarvis – Home - Google Chrome',
    controls: [['tab', 'Jarvis – Home'], ['edit', 'Address and search bar'], ['button', 'Reload']] },
];

const running = ['vscode', 'spotify', 'notepad', 'chrome'] as const;

const initialTabs = (): ChromeTab[] => [
  { id: 'tab-101', title: 'Jarvis – Home', url: 'https://jarvis.example.net/', focused: true, elements: [
    ['link', 'Notes', ''], ['textbox', 'Search', ''], ['button', 'Search', ''], ['combobox', 'Language', 'English'], ['button', 'Delete draft', ''],
  ] },
  { id: 'tab-102', title: 'DMI – Vejret i Aarhus', url: 'https://www.dmi.dk/vejr/', focused: false, elements: [
    ['link', 'Dagens vejr', ''], ['link', 'Radar', ''], ['button', 'Skift by', ''],
  ] },
  { id: 'tab-103', title: 'DanAakesen/jarvis', url: 'https://github.com/DanAakesen/jarvis', focused: false, elements: [
    ['link', 'Issues', ''], ['link', 'Pull requests', ''], ['button', 'Code', ''],
  ] },
];

/** The repo the bridge may open (it only ever opens paths under C:\Repo). */
const repoFolders = new Set(['jarvis', 'jarvis\\apps', 'jarvis\\apps\\backend', 'jarvis\\docs']);
const repoFiles = new Set(['jarvis\\README.md', 'jarvis\\apps\\backend\\package.json', 'jarvis\\docs\\architecture.md']);

/** A real 1x1 PNG: the capture validators check the PNG signature and the base64 round trip. */
const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** A stable, valid UUID for a snapshot, so a case can name the snapshot a fresh snapshot call returns. */
export function snapshotIdFor(kind: 'uia' | 'capture' | 'tab', key: string): string {
  const hex = createHash('sha256').update(`${kind}:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/gu, '');
const asString = (value: unknown): string => {
  if (typeof value !== 'string') throw new Refused('not_allowed');
  return value;
};

class FakeSocket extends EventEmitter {
  /** `ws` WebSocket.OPEN and WebSocket.CLOSED. */
  readyState = 1;

  constructor(private readonly pc: FakePc) { super(); }

  send(data: string, callback?: (error?: Error) => void): void {
    callback?.();
    this.pc.receive(this, data);
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    setImmediate(() => this.emit('close', code, Buffer.from(reason)));
  }

  terminate(): void { this.close(1006, 'terminated'); }

  ping(): void {}
}

export class FakePc {
  /** Every command the backend sent, in order (for assertions). */
  readonly commands: { readonly command: string; readonly arguments: Args }[] = [];
  mode: PcMode = 'healthy';
  /** The Chrome extension is switched off in the bridge settings (every browser command answers `browser_off`). */
  chromeOff = false;
  clipboard = 'Meeting notes: call Anna at 10 about the invoice';
  readonly tabs: ChromeTab[] = initialTabs();
  readonly typed: string[] = [];
  private readonly windows: string[] = [...running];
  private foreground = 0;
  private nextTab = 104;
  private socket: FakeSocket | undefined;

  constructor(private readonly connection: PcBridgeConnection) {}

  get attached(): boolean { return this.socket !== undefined && this.socket.readyState === 1; }

  /** Dan's PC connects to the backend, as the tray app does when it starts. */
  attach(): void {
    const socket = new FakeSocket(this);
    this.socket = socket;
    this.connection.attach(socket as unknown as WebSocket);
    setImmediate(() => {
      if (socket.readyState === 1) socket.emit('message', Buffer.from(JSON.stringify({ type: 'status', controlPaused: false })), false);
    });
  }

  /** Dan's PC goes away: the socket closes and the connection sees the bridge as offline. */
  detach(): void {
    const socket = this.socket;
    this.socket = undefined;
    // The socket reads as closed at once; `close` reaches the connection a tick later, as with `ws`.
    socket?.close(1006, 'PC went offline');
  }

  /** Brings the fake in line with the dependency tokens a case asks to fail. Called before every tool runs. */
  sync(down: ReadonlySet<string>): void {
    if (down.has('pc-bridge')) { this.detach(); return; }
    this.mode = down.has('pc-bridge-silent') ? 'silent' : down.has('pc-bridge-drops') ? 'drops'
      : down.has('pc-bridge-failing') ? 'failing' : down.has('pc-bridge-garbled') ? 'garbled' : 'healthy';
    this.chromeOff = down.has('pc-chrome');
    if (!this.attached) this.attach();
  }

  /** Called by the socket for every command the backend writes. */
  receive(socket: FakeSocket, data: string): void {
    const message = JSON.parse(data) as { id: string; type: string; command: string; arguments: Args };
    this.commands.push({ command: message.command, arguments: message.arguments });
    if (this.mode === 'silent') return;
    if (this.mode === 'drops') { setImmediate(() => socket.close(1006, 'connection lost')); return; }
    let reply: Record<string, unknown>;
    if (this.mode === 'failing') reply = { id: message.id, type: 'error', error: 'failed' };
    else if (this.mode === 'garbled') reply = { id: message.id, type: 'result', result: { unexpected: true } };
    else {
      try { reply = { id: message.id, type: 'result', result: this.execute(message.command, message.arguments) }; }
      catch (error) {
        if (!(error instanceof Refused)) throw error;
        reply = { id: message.id, type: 'error', error: error.code };
      }
    }
    setImmediate(() => {
      if (socket.readyState === 1) socket.emit('message', Buffer.from(JSON.stringify(reply)), false);
    });
  }

  // ---- The desktop -------------------------------------------------------------------------------------------------------

  private app(application: string): DesktopApp { return installed.find((entry) => entry.application === application)!; }
  private get front(): DesktopApp { return this.app(this.windows[this.foreground] ?? 'vscode'); }
  private bringToFront(application: string): void {
    if (!this.windows.includes(application)) this.windows.push(application);
    this.foreground = this.windows.indexOf(application);
  }

  private execute(command: string, args: Args): Result {
    if (command.startsWith('browser_')) return this.browser(command, args);
    switch (command) {
      case 'open_url': return this.openUrl(asString(args.url));
      case 'open_app': return this.openApp(asString(args.app));
      case 'close_app': return this.closeApp(asString(args.app));
      case 'media': return { controlled: true, action: args.action };
      case 'open_folder': {
        if (!repoFolders.has(asString(args.relativePath))) throw new Refused('not_found');
        this.bringToFront('explorer');
        return { opened: true };
      }
      case 'open_file': {
        if (!repoFiles.has(asString(args.relativePath))) throw new Refused('not_found');
        this.bringToFront('vscode');
        return { opened: true };
      }
      case 'active_window': return { title: this.front.title };
      case 'focus_window': {
        const wanted = asString(args.title);
        const match = this.windows.find((application) => this.app(application).title === wanted);
        if (!match) throw new Refused('not_found');
        this.bringToFront(match);
        return { activated: true };
      }
      case 'uia_snapshot': {
        const front = this.front;
        return {
          snapshotId: snapshotIdFor('uia', front.application), application: front.application,
          elements: front.controls.map(([role, name], index) => ({ index, role, name })),
        };
      }
      case 'uia_act': return this.uiaAct(args);
      case 'window_capture': {
        const front = this.front;
        return { snapshotId: snapshotIdFor('capture', front.application), application: front.application, width: 1280, height: 720, png: onePixelPng };
      }
      case 'click_point': return { acted: true, action: 'click' };
      case 'scroll_point': return { acted: true, action: args.direction === 'up' ? 'scroll_up' : 'scroll_down' };
      case 'clipboard_read': return { text: this.clipboard };
      case 'clipboard_write': { this.clipboard = asString(args.text); return { written: true }; }
      default: throw new Refused('not_allowed');
    }
  }

  private openApp(wanted: string): Result {
    const key = normalize(wanted);
    const exact = installed.filter((entry) => normalize(entry.display) === key || entry.application === key);
    const candidates = exact.length > 0 ? exact : installed.filter((entry) => normalize(entry.display).includes(key));
    if (candidates.length === 0) throw new Refused('not_found');
    if (candidates.length > 1) return { opened: false, candidates: candidates.map((entry) => entry.display) };
    const app = candidates[0]!;
    this.bringToFront(app.application);
    return { opened: true, app: app.display };
  }

  private closeApp(wanted: string): Result {
    const key = normalize(wanted);
    const matching = this.windows.filter((application) => normalize(this.app(application).display).includes(key) || application === key);
    if (matching.length === 0) throw new Refused('not_found');
    for (const application of matching) this.windows.splice(this.windows.indexOf(application), 1);
    this.foreground = Math.min(this.foreground, Math.max(0, this.windows.length - 1));
    return { closing: true, windows: matching.length };
  }

  private uiaAct(args: Args): Result {
    const front = this.front;
    if (args.snapshotId !== snapshotIdFor('uia', front.application)) throw new Refused('stale');
    const action = asString(args.action);
    if (action === 'keys' || action === 'type_focused') {
      if (action === 'type_focused') this.typed.push(asString(args.text));
      return { acted: true, action };
    }
    const index = args.elementIndex;
    if (typeof index !== 'number' || !front.controls[index]) throw new Refused('stale');
    const [, name] = front.controls[index]!;
    if (action === 'click' && args.confirmed !== true && /\b(delete|remove)\b/iu.test(name)) {
      return { confirmationRequired: true, actionKind: 'computer_use', summary: 'Activate a potentially destructive Windows control.' };
    }
    if (action === 'type') this.typed.push(asString(args.text));
    return { acted: true, action };
  }

  // ---- Chrome and its extension --------------------------------------------------------------------------------------------

  private openUrl(url: string): Result {
    const existing = this.tabs.find((tab) => tab.url === url);
    for (const tab of this.tabs) tab.focused = false;
    if (existing) existing.focused = true;
    else {
      const host = new URL(url).hostname;
      this.tabs.push({ id: `tab-${this.nextTab}`, title: host, url, focused: true, elements: [
        ['link', 'Home', ''], ['textbox', 'Search', ''], ['button', 'Search', ''],
      ] });
      this.nextTab += 1;
    }
    this.bringToFront('chrome');
    return { opened: true };
  }

  private tab(args: Args): ChromeTab {
    const id = asString(args.tabId);
    const tab = this.tabs.find((entry) => entry.id === id);
    if (!tab) throw new Refused('not_found');
    return tab;
  }

  private browser(command: string, args: Args): Result {
    if (this.chromeOff) throw new Refused('browser_off');
    if (command === 'browser_tabs') {
      const offset = typeof args.offset === 'number' ? args.offset : 0;
      const page = this.tabs.slice(offset, offset + 20);
      return {
        tabs: page.map(({ id, title, url, focused }) => ({ id, title, url, focused })),
        nextOffset: offset + 20 < this.tabs.length ? offset + 20 : null,
      };
    }
    const tab = this.tab(args);
    if (command === 'browser_snapshot') {
      return {
        tabId: tab.id, snapshotId: snapshotIdFor('tab', tab.id), title: tab.title, url: tab.url,
        elements: tab.elements.map(([role, name, value], index) => ({ index, role, name, value })),
      };
    }
    if (command !== 'browser_act') throw new Refused('not_allowed');
    if (args.snapshotId !== snapshotIdFor('tab', tab.id)) throw new Refused('stale');
    const action = asString(args.action);
    if (action === 'keys' || action === 'type_focused') {
      if (action === 'type_focused') this.typed.push(asString(args.text));
      return { acted: true, action };
    }
    const element = typeof args.elementIndex === 'number' ? tab.elements[args.elementIndex] : undefined;
    if (!element) throw new Refused('stale');
    if (action === 'click' && args.confirmed !== true && /\b(delete|remove)\b/iu.test(element[1])) {
      return { confirmationRequired: true, actionKind: 'computer_use', summary: `Click the ${element[0]} "${element[1]}" in Chrome.` };
    }
    if (action === 'type') this.typed.push(asString(args.text));
    return { acted: true, action };
  }
}
