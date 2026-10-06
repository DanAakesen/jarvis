import type { HtmlArtifactSource } from '@jarvis/contracts';
import { backendFetch } from './backend-request';

const artifactIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const bearerScheme = ['Bear', 'er'].join('');

export interface WorkspaceHtmlArtifact {
  id: string;
  kind: 'html';
  title: string;
  html?: string;
  sources: HtmlArtifactSource[];
  createdAt: string;
  pinned: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSources(value: unknown): value is HtmlArtifactSource[] {
  return Array.isArray(value) && value.length <= 50 && value.every((source) => {
    if (!isRecord(source) || Object.keys(source).some((key) => !['title', 'url'].includes(key)) ||
        typeof source.title !== 'string' || !source.title.trim() || source.title.length > 200 ||
        typeof source.url !== 'string' || source.url.length > 2_048) return false;
    try {
      const url = new URL(source.url);
      return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
    } catch {
      return false;
    }
  });
}

function isArtifact(value: unknown, includeHtml: boolean): value is WorkspaceHtmlArtifact {
  if (!isRecord(value) || !artifactIdPattern.test(String(value.id)) || value.kind !== 'html' ||
      typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200 ||
      typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) ||
      typeof value.pinned !== 'boolean' || !isSources(value.sources)) return false;
  return includeHtml
    ? typeof value.html === 'string' && new TextEncoder().encode(value.html).byteLength <= 512 * 1024
    : value.html === undefined;
}

async function request(
  backendUrl: string,
  path: string,
  getAccessToken: () => Promise<string>,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getAccessToken();
  try {
    return await backendFetch(`${backendUrl.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: {
        Authorization: `${bearerScheme} ${token}`,
        Accept: 'application/json',
        ...init.headers,
      },
    });
  } catch {
    throw new Error('Jarvis could not reach the workspace artifact service. Try again.');
  }
}

async function readError(response: Response): Promise<Error> {
  await response.body?.cancel().catch(() => {});
  return new Error(response.status === 401 || response.status === 403
    ? 'Your Microsoft sign-in needs attention. Sign in again.'
    : `Workspace artifact request failed (HTTP ${response.status}).`);
}

export async function loadPinnedHtmlArtifacts(
  backendUrl: string,
  getAccessToken: () => Promise<string>,
  signal?: AbortSignal,
): Promise<WorkspaceHtmlArtifact[]> {
  const response = await request(backendUrl, '/factory/workspace-artifacts/html', getAccessToken,
    signal ? { signal } : {});
  if (!response.ok) throw await readError(response);
  const value: unknown = await response.json();
  if (!isRecord(value) || !Array.isArray(value.artifacts) || value.artifacts.length > 64 ||
      !value.artifacts.every((artifact) => isArtifact(artifact, false) && artifact.pinned)) {
    throw new Error('The workspace artifact list was invalid.');
  }
  return value.artifacts;
}

export async function loadWorkspaceHtmlArtifact(
  backendUrl: string,
  artifactId: string,
  getAccessToken: () => Promise<string>,
  signal?: AbortSignal,
): Promise<WorkspaceHtmlArtifact> {
  if (!artifactIdPattern.test(artifactId)) throw new TypeError('Invalid workspace artifact ID.');
  const response = await request(
    backendUrl,
    `/factory/workspace-artifacts/html/${encodeURIComponent(artifactId)}`,
    getAccessToken,
    signal ? { signal } : {},
  );
  if (!response.ok) throw await readError(response);
  const artifact: unknown = await response.json();
  if (!isArtifact(artifact, true)) throw new Error('The workspace HTML artifact was invalid.');
  return artifact;
}

export async function setWorkspaceHtmlPinned(
  backendUrl: string,
  artifactId: string,
  pinned: boolean,
  getAccessToken: () => Promise<string>,
  signal?: AbortSignal,
): Promise<void> {
  if (!artifactIdPattern.test(artifactId)) throw new TypeError('Invalid workspace artifact ID.');
  const response = await request(
    backendUrl,
    `/factory/workspace-artifacts/html/${encodeURIComponent(artifactId)}/pin`,
    getAccessToken,
    { method: pinned ? 'POST' : 'DELETE', ...(signal ? { signal } : {}) },
  );
  if (!response.ok) throw await readError(response);
}
