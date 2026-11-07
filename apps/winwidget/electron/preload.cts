import { contextBridge, ipcRenderer } from 'electron';
import type { WidgetBridge } from './contract.js';

// Sandboxed preload must remain self-contained CJS: no runtime local imports.
const bridge: WidgetBridge = Object.freeze({
  setExpanded: (expanded: boolean) => ipcRenderer.invoke('widget:expand', expanded),
  dock: (edge: 'left' | 'right') => ipcRenderer.invoke('widget:dock', edge),
  close: () => ipcRenderer.invoke('widget:close'),
});
contextBridge.exposeInMainWorld('jarvisWidget', bridge);
