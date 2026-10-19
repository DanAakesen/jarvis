import { createHash } from 'node:crypto';

export const normalizePath = (path: string): string => path.normalize('NFC');
export const foldPath = (path: string): string => normalizePath(path).toUpperCase().toLowerCase().normalize('NFC');
export const normalizeContent = (text: string): string => text.replace(/\r\n/g, '\n');
export const contentHash = (text: string): string =>
  createHash('sha256').update(normalizeContent(text), 'utf8').digest('hex');
export const contentSize = (text: string): number => new TextEncoder().encode(text).byteLength;

export function isSafePath(path: string): boolean {
  return path.length > 0 && !/[\\:]/u.test(path) &&
    ![...path].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) &&
    path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}
