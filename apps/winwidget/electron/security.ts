export const APP_URL = 'jarvis-widget://app/';
export const DEV_URL = 'http://127.0.0.1:5183/';
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'none'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";

export function isTrustedPage(url: string, development: boolean): boolean {
  // Only the entry document may invoke IPC, never other resources or frames.
  return url === (development ? DEV_URL : APP_URL);
}

export function assetPath(url: string): string | null {
  const parsed = new URL(url);
  if (parsed.protocol !== 'jarvis-widget:' || parsed.host !== 'app' || parsed.search) return null;
  if (parsed.pathname === '/') return 'index.html';
  return /^\/assets\/[\w-]+\.(js|css)$/.test(parsed.pathname) ? parsed.pathname.slice(1) : null;
}
