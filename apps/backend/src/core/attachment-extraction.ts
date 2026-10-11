import { unzipSync } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const maxExtractedCharacters = 100_000;
const maxZipEntries = 1_000;
const maxUncompressedZipBytes = 50 * 1024 * 1024;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
  trimValues: false,
});

function boundedText(value: string): string {
  return [...value].filter((character) => character.codePointAt(0) !== 0)
    .join('').slice(0, maxExtractedCharacters).trim();
}

function validUtf8(buffer: Buffer): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/u, '');
}

function zipEntries(buffer: Buffer): Record<string, Uint8Array> {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('Invalid Office document');
  }
  const directoryStart = Math.max(0, buffer.length - 65_557);
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= directoryStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('Invalid Office document');
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const directorySize = buffer.readUInt32LE(endOffset + 12);
  const directoryOffset = buffer.readUInt32LE(endOffset + 16);
  if (entryCount < 1 || entryCount > maxZipEntries ||
      directoryOffset + directorySize > endOffset || entryCount === 0xffff) {
    throw new Error('Office document exceeds extraction limits');
  }
  let offset = directoryOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('Invalid Office document');
    }
    totalUncompressed += buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== directoryOffset + directorySize || totalUncompressed > maxUncompressedZipBytes) {
    throw new Error('Office document exceeds extraction limits');
  }
  return unzipSync(new Uint8Array(buffer));
}

function localName(value: string): string {
  return value.slice(value.lastIndexOf(':') + 1);
}

function nodes(value: unknown, name: string): unknown[] {
  if (Array.isArray(value)) return value.flatMap((item) => nodes(item, name));
  if (typeof value !== 'object' || value === null) return [];
  const record = value as Record<string, unknown>;
  const matches: unknown[] = [];
  for (const [key, child] of Object.entries(record)) {
    if (localName(key) === name) {
      matches.push(...(Array.isArray(child) ? child : [child]));
    }
    matches.push(...nodes(child, name));
  }
  return matches;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function textNodes(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(textNodes);
  if (typeof value !== 'object' || value === null) return [];
  const record = value as Record<string, unknown>;
  return Object.entries(record).flatMap(([key, child]) =>
    key === '#text' ? (typeof child === 'string' ? [child] : []) :
      key.startsWith('@_') ? [] : textNodes(child));
}

function parseXml(buffer: Uint8Array): unknown {
  const xml = validUtf8(Buffer.from(buffer));
  if (xml.length > maxUncompressedZipBytes || XMLValidator.validate(xml) !== true) {
    throw new Error('Invalid Office document');
  }
  return parser.parse(xml);
}

function extractDocx(buffer: Buffer): string {
  const files = zipEntries(buffer);
  const document = files['word/document.xml'];
  if (!document) throw new Error('Invalid Word document');
  const parsed = parseXml(document);
  const paragraphs = nodes(parsed, 'p').map((paragraph) => textNodes(paragraph).join(''));
  return boundedText(paragraphs.filter(Boolean).join('\n'));
}

function extractXlsx(buffer: Buffer): string {
  const files = zipEntries(buffer);
  const workbookXml = files['xl/workbook.xml'];
  const relationshipsXml = files['xl/_rels/workbook.xml.rels'];
  if (!workbookXml || !relationshipsXml) throw new Error('Invalid spreadsheet');
  const workbook = parseXml(workbookXml);
  const relationships = parseXml(relationshipsXml);
  const sheets = nodes(workbook, 'sheet').slice(0, 3);
  const targets = new Map(nodes(relationships, 'Relationship').map((relationship) => [
    String(record(relationship)['@_Id'] ?? ''),
    String(record(relationship)['@_Target'] ?? ''),
  ]));
  const sharedXml = files['xl/sharedStrings.xml'];
  const sharedStrings = sharedXml
    ? nodes(parseXml(sharedXml), 'si').map((item) => textNodes(item).join(''))
    : [];
  const values: string[] = [];
  for (const sheetValue of sheets) {
    const sheet = record(sheetValue);
    const relationshipId = String(sheet['@_r:id'] ?? sheet['@_id'] ?? '');
    const target = targets.get(relationshipId);
    if (!target || target.includes('..') || target.startsWith('/')) continue;
    const worksheet = files[`xl/${target.replace(/^\/?xl\//u, '')}`] ??
      files[`xl/${target.replace(/^\/?\/?/u, '')}`];
    if (!worksheet) continue;
    const parsed = parseXml(worksheet);
    for (const cellValue of nodes(parsed, 'c').slice(0, 5_000)) {
      const cell = record(cellValue);
      const cellType = cell['@_t'];
      const rawText = textNodes(cell.v).join('');
      const value = cellType === 's' && /^\d+$/u.test(rawText)
        ? sharedStrings[Number(rawText)] ?? ''
        : cellType === 'inlineStr'
          ? textNodes(cell.is).join('')
          : rawText;
      if (value) values.push(value);
      if (values.join('\n').length >= maxExtractedCharacters) break;
    }
    if (values.join('\n').length >= maxExtractedCharacters) break;
  }
  return boundedText(values.join('\n'));
}

export function extractAttachmentText(extension: string, buffer: Buffer): string {
  switch (extension) {
    case 'txt':
    case 'md':
    case 'csv':
    case 'json':
    case 'log':
      return boundedText(validUtf8(buffer));
    case 'docx':
      return extractDocx(buffer);
    case 'xlsx':
      return extractXlsx(buffer);
    default:
      throw new Error('Unsupported attachment type');
  }
}
