/** Dan's chosen shell panel widths, remembered on this device. */
const storageKey = (name: string) => `jarvis.shell.${name}Width`;

export function readPanelWidth(name: 'sidebar' | 'context', min: number, max: number): number | null {
  try {
    const value = Number(localStorage.getItem(storageKey(name)));
    return Number.isFinite(value) && value >= min && value <= max ? value : null;
  } catch {
    return null;
  }
}

export function savePanelWidth(name: 'sidebar' | 'context', width: number) {
  try { localStorage.setItem(storageKey(name), String(width)); } catch { /* Width stays for this session only. */ }
}
