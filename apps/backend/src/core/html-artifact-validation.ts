import { defaultTreeAdapter, parse, type DefaultTreeAdapterMap, type ParserError } from 'parse5';
import { htmlAppLibraries } from '@jarvis/contracts';
import {
  isWellFormedUtf16,
  workspaceHtmlSizeLimit,
  type WorkspaceHtmlSource,
} from '../database/workspace-html-artifact-store.js';

type HtmlNode = DefaultTreeAdapterMap['node'];

function validSource(value: unknown): value is WorkspaceHtmlSource {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => key !== 'title' && key !== 'url') ||
      typeof source.title !== 'string' || !source.title.trim() || source.title !== source.title.trim() ||
      source.title.length > 200 || typeof source.url !== 'string' ||
      source.url !== source.url.trim() || source.url.length > 2_048) return false;
  try {
    const url = new URL(source.url);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function validateHtmlApp(title: unknown, html: unknown, sources: unknown): html is string {
  if (typeof title !== 'string' || !title.trim() || title !== title.trim() || title.length > 200 ||
      typeof html !== 'string' || !html.trim() || !isWellFormedUtf16(html) ||
      Buffer.byteLength(html, 'utf8') > workspaceHtmlSizeLimit ||
      !Array.isArray(sources) || sources.length > 50 || !sources.every(validSource)) return false;

  const errors: ParserError[] = [];
  const document = parse(html, { onParseError: (error) => errors.push(error) });
  if (errors.length > 0) return false;

  let hasHtmlDoctype = false;
  let forbiddenElement = false;
  const visit = (node: HtmlNode) => {
    if (defaultTreeAdapter.isDocumentTypeNode(node) && node.name.toLowerCase() === 'html') {
      hasHtmlDoctype = true;
    }
    if (defaultTreeAdapter.isElementNode(node)) {
      if (node.tagName === 'base' ||
          node.tagName === 'script' && node.attrs.some(({ name }) => name.toLowerCase() === 'src') ||
          node.tagName === 'meta' && node.attrs.some(({ name, value }) =>
            name.toLowerCase() === 'http-equiv' && value.trim().toLowerCase() === 'refresh')) {
        forbiddenElement = true;
      }
      if (node.tagName === 'script') {
        const library = node.attrs.find(({ name }) => name.toLowerCase() === 'data-jarvis-lib');
        if (library && (node.attrs.length !== 1 || !htmlAppLibraries.includes(library.value) ||
            node.childNodes.some((child) => !('value' in child) ||
              typeof child.value !== 'string' || child.value.trim().length > 0))) {
          forbiddenElement = true;
        }
      }
      if (node.tagName === 'template') {
        for (const child of (node as DefaultTreeAdapterMap['template']).content.childNodes) visit(child);
      }
    }
    if ('childNodes' in node) {
      for (const child of node.childNodes) visit(child);
    }
  };
  visit(document);
  return hasHtmlDoctype && !forbiddenElement;
}
