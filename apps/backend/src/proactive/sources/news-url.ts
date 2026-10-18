import { isIP } from 'node:net';

const blockedSuffixes = [
  '.localhost',
  '.local',
  '.internal',
  '.localdomain',
  '.lan',
  '.home',
  '.corp',
  '.intranet',
  '.home.arpa',
];

export function validateFeedUrl(value: string): URL | null {
  if (value.length > 300) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;

  const hostname = url.hostname.toLowerCase();
  const unbracketedHostname = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (hostname.length > 253 || !hostname.includes('.') || !/^[a-z\d.-]+$/u.test(hostname) ||
      isIP(unbracketedHostname) !== 0) return null;

  const labels = hostname.split('.');
  const lastLabel = labels.at(-1) ?? '';
  if (hostname === 'localhost' || /^\d+$/u.test(lastLabel) ||
      blockedSuffixes.some((suffix) => hostname.endsWith(suffix))) return null;

  url.hash = '';
  return url;
}
