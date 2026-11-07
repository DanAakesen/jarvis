import { app, BrowserWindow, ipcMain, protocol, screen, session } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { dockBounds, EXPANDED_WIDTH, resizeBounds, snapBounds, WINDOW_HEIGHT } from './geometry.js';
import { APP_URL, assetPath, CSP, DEV_URL, isTrustedPage } from './security.js';

const development = !app.isPackaged && process.argv.includes('--dev');
const directory = fileURLToPath(new URL('.', import.meta.url));
let widget: BrowserWindow | null = null;

protocol.registerSchemesAsPrivileged([
  { scheme: 'jarvis-widget', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function requireWidget(event: IpcMainInvokeEvent): BrowserWindow {
  if (!widget || widget.isDestroyed() || event.sender !== widget.webContents ||
      event.senderFrame !== widget.webContents.mainFrame ||
      !isTrustedPage(event.senderFrame.url, development)) {
    throw new Error('Widget request refused');
  }
  return widget;
}

ipcMain.handle('widget:expand', (event, expanded: unknown) => {
  const window = requireWidget(event);
  if (typeof expanded !== 'boolean') throw new Error('Invalid expansion');
  const bounds = window.getBounds();
  window.setBounds(resizeBounds(bounds, screen.getDisplayMatching(bounds).workArea, expanded));
});
ipcMain.handle('widget:dock', (event, edge: unknown) => {
  const window = requireWidget(event);
  if (edge !== 'left' && edge !== 'right') throw new Error('Invalid edge');
  const bounds = window.getBounds();
  window.setBounds(dockBounds(bounds, screen.getDisplayMatching(bounds).workArea, edge));
});
ipcMain.handle('widget:close', (event) => { requireWidget(event).close(); });

function settleWindow() {
  if (!widget || widget.isDestroyed()) return;
  const bounds = widget.getBounds();
  const next = snapBounds(bounds, screen.getDisplayMatching(bounds).workArea);
  if (Object.keys(next).some(key => next[key as keyof typeof next] !== bounds[key as keyof typeof bounds])) {
    widget.setBounds(next);
  }
}

async function createWidget() {
  const area = screen.getPrimaryDisplay().workArea;
  const initial = dockBounds({ x: area.x, y: area.y + 80, width: EXPANDED_WIDTH, height: WINDOW_HEIGHT }, area, 'right');
  const window = new BrowserWindow({
    ...initial, title: 'Jarvis Windows companion scaffold',
    frame: false, resizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, show: false, backgroundColor: '#fffaf1',
    webPreferences: {
      preload: join(directory, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, webviewTag: false, devTools: development,
    },
  });
  widget = window;
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-redirect', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  // Native drag regions move at OS speed. Snap after release, never fight the drag.
  window.on('moved', settleWindow);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { widget = null; });
  await window.loadURL(development ? DEV_URL : APP_URL);
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', event => event.preventDefault());
  // No external network in the scaffold. Development permits only its fixed Vite origin.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const allowed = url.protocol === 'jarvis-widget:' && url.host === 'app' ||
      development && ['http:', 'ws:'].includes(url.protocol) && url.host === '127.0.0.1:5183';
    callback({ cancel: !allowed });
  });
  protocol.handle('jarvis-widget', async request => {
    const asset = assetPath(request.url);
    if (request.method !== 'GET' || !asset) return new Response('Not found', { status: 404 });
    try {
      const body = await readFile(join(directory, '../renderer', asset));
      const contentType = asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html';
      return new Response(body, { headers: { 'Content-Type': contentType, 'Content-Security-Policy': CSP } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
  screen.on('display-removed', settleWindow);
  screen.on('display-metrics-changed', settleWindow);
  await createWidget();
}).catch(() => {
  console.error('The Jarvis widget could not start. Rebuild it and try again.');
  app.exit(1);
});
app.on('window-all-closed', () => app.quit());
