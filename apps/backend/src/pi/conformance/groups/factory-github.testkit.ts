import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';

/**
 * An in-memory GitHub for the Factory tools: the REST routes of api.github.com that the Factory code reads and writes, over
 * seeded repositories, answered through a `fetch` stand-in. The production clients and tools parse these answers exactly as
 * they parse GitHub's, so a drift in either shows up in the conformance run. Nothing here touches the network.
 */

type Json = Record<string, unknown>;

/** A 40-character commit id that reads well in a test: `sha(0x705)`. */
export const sha = (value: number): string => value.toString(16).padStart(40, '0');

const stamp = (day: number, hour = 10) => `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`;
export const timestamps = { early: stamp(18), middle: stamp(19), late: stamp(20), now: stamp(21) } as const;

export interface FakeComment { id: number; user: string; body: string; createdAt: string }
export interface FakeReviewComment extends FakeComment { path: string; line: number }
export interface FakeThread { resolved: boolean; path: string; line: number; comments: { author: string; body: string; createdAt: string }[] }
export interface FakePullFile { filename: string; status: 'added' | 'modified' | 'removed'; additions: number; deletions: number; patch: string }

export interface FakePull {
  head: { ref: string; sha: string };
  base: { ref: string };
  draft: boolean;
  merged: boolean;
  mergeSha: string | null;
  mergeable: boolean | null;
  /** Issue numbers the pull request closes (its "Fixes #n" links). */
  closes: number[];
  files: FakePullFile[];
  reviewComments: FakeReviewComment[];
  threads: FakeThread[];
}

/** An issue, or a pull request (GitHub numbers both from one sequence and lists a pull request among the issues). */
export interface FakeItem {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  stateReason: string | null;
  labels: string[];
  assignees: string[];
  user: string;
  milestone: number | null;
  comments: FakeComment[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  pull?: FakePull;
}

export interface FakeCheckRun { id: number; name: string; status: string; conclusion: string | null; suiteId: number }
export interface FakeRun {
  id: number; name: string; displayTitle: string; path: string; status: string; conclusion: string | null;
  branch: string; sha: string; suiteId: number; createdAt: string; updatedAt: string;
}
export interface FakeJob { id: number; runId: number; name: string; status: string; conclusion: string | null; log: string }
export interface FakeCommit { sha: string; message: string; author: string; date: string; files: { filename: string; status: string; additions: number; deletions: number }[] }

export interface FakeRepo {
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  files: Map<string, string>;
  branches: Map<string, string>;
  /** Newest first. */
  commits: FakeCommit[];
  items: Map<number, FakeItem>;
  nextNumber: number;
  labels: Map<string, { name: string; color: string; description: string }>;
  milestones: { number: number; title: string; state: 'open' | 'closed'; dueOn: string | null }[];
  checkRuns: Map<string, FakeCheckRun[]>;
  runs: FakeRun[];
  jobs: FakeJob[];
  dispatched: { workflow: string; ref: string }[];
  nextId: number;
}

export interface FakeGitHub {
  /** The `fetch` for api.github.com (and the Actions log host); other hosts go to `delegate` or are refused. */
  readonly fetch: typeof fetch;
  readonly repos: Map<string, FakeRepo>;
  repository(fullName: string): FakeRepo;
  addRepository(fullName: string, options?: { defaultBranch?: string; isPrivate?: boolean; files?: Record<string, string> }): FakeRepo;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const empty = (status: number) => new Response(null, { status });
const notFound = () => json(404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest' });
const invalid = (message: string) => json(422, { message: 'Validation Failed', errors: [{ message }] });

const object = (value: unknown): Json | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined;
const text = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const blobSha = (content: string) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');

function page<T>(entries: readonly T[], url: URL): T[] {
  const size = Math.min(Math.max(Number(url.searchParams.get('per_page') ?? 30) || 30, 1), 100);
  const number = Math.max(Number(url.searchParams.get('page') ?? 1) || 1, 1);
  return entries.slice((number - 1) * size, number * size);
}

function childrenOf(repo: FakeRepo, directory: string): { name: string; path: string; type: 'file' | 'dir'; size: number; sha: string }[] {
  const prefix = directory ? `${directory}/` : '';
  const found = new Map<string, { name: string; path: string; type: 'file' | 'dir'; size: number; sha: string }>();
  for (const [path, content] of [...repo.files].sort(([left], [right]) => left.localeCompare(right))) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const [name, ...deeper] = rest.split('/');
    if (!name) continue;
    if (deeper.length > 0) found.set(name, { name, path: `${prefix}${name}`, type: 'dir', size: 0, sha: blobSha(`tree ${prefix}${name}`) });
    else found.set(name, { name, path, type: 'file', size: Buffer.byteLength(content), sha: blobSha(content) });
  }
  return [...found.values()];
}

const wrapBase64 = (content: string) => (Buffer.from(content).toString('base64').match(/.{1,60}/gu) ?? []).join('\n');

export function createFakeGitHub(options: { readonly delegate: () => typeof fetch | undefined }): FakeGitHub {
  const repos = new Map<string, FakeRepo>();
  const key = (fullName: string) => fullName.toLowerCase();

  const repository = (fullName: string): FakeRepo => {
    const found = repos.get(key(fullName));
    if (!found) throw new Error(`The fake GitHub has no repository ${fullName}.`);
    return found;
  };

  function addRepository(fullName: string, extra: { defaultBranch?: string; isPrivate?: boolean; files?: Record<string, string> } = {}): FakeRepo {
    const defaultBranch = extra.defaultBranch ?? 'main';
    const head = sha(0x100 + repos.size);
    const repo: FakeRepo = {
      fullName, defaultBranch, isPrivate: extra.isPrivate ?? true,
      files: new Map(Object.entries(extra.files ?? { 'README.md': `# ${fullName.split('/')[1]}\n` })),
      branches: new Map([[defaultBranch, head]]),
      commits: [{ sha: head, message: 'Initial commit', author: 'Dan Aakesen', date: timestamps.early, files: [{ filename: 'README.md', status: 'added', additions: 1, deletions: 0 }] }],
      items: new Map(), nextNumber: 1, labels: new Map(), milestones: [], checkRuns: new Map(), runs: [], jobs: [], dispatched: [], nextId: 5_000,
    };
    repos.set(key(fullName), repo);
    return repo;
  }

  // ---- Rendering ---------------------------------------------------------------------------------------------------------

  const issueUrl = (name: string, item: FakeItem) => `${'https://github.com'}/${name}/${item.pull ? 'pull' : 'issues'}/${item.number}`;

  function issueJson(name: string, item: FakeItem): Json {
    return {
      number: item.number, title: item.title, body: item.body, state: item.state, state_reason: item.stateReason,
      labels: item.labels.map((label) => ({ name: label, color: 'ededed' })),
      assignees: item.assignees.map((login) => ({ login })),
      milestone: item.milestone === null ? null : { number: item.milestone, title: `Milestone ${item.milestone}` },
      user: { login: item.user }, html_url: issueUrl(name, item), comments: item.comments.length,
      created_at: item.createdAt, updated_at: item.updatedAt, closed_at: item.closedAt,
      repository_url: `https://api.github.com/repos/${name}`,
      ...(item.pull ? { pull_request: { url: `https://api.github.com/repos/${name}/pulls/${item.number}` }, draft: item.pull.draft, merged: item.pull.merged } : {}),
    };
  }

  function pullJson(name: string, item: FakeItem): Json {
    const pull = item.pull!;
    return {
      number: item.number, title: item.title, body: item.body, state: item.state, draft: pull.draft, merged: pull.merged,
      merge_commit_sha: pull.mergeSha, mergeable: pull.mergeable, html_url: issueUrl(name, item), node_id: `PR_node_${item.number}`,
      user: { login: item.user }, head: { ref: pull.head.ref, sha: pull.head.sha }, base: { ref: pull.base.ref },
      created_at: item.createdAt, updated_at: item.updatedAt,
    };
  }

  const commentJson = (name: string, item: FakeItem, comment: FakeComment): Json => ({
    id: comment.id, user: { login: comment.user }, body: comment.body, created_at: comment.createdAt,
    html_url: `${issueUrl(name, item)}#issuecomment-${comment.id}`,
  });

  const runJson = (name: string, run: FakeRun): Json => ({
    id: run.id, name: run.name, display_title: run.displayTitle, path: run.path, status: run.status, conclusion: run.conclusion,
    head_branch: run.branch, head_sha: run.sha, check_suite_id: run.suiteId, workflow_id: 300 + (run.id % 10),
    created_at: run.createdAt, updated_at: run.updatedAt, html_url: `https://github.com/${name}/actions/runs/${run.id}`,
  });

  const jobJson = (name: string, job: FakeJob): Json => ({
    id: job.id, run_id: job.runId, name: job.name, status: job.status, conclusion: job.conclusion,
    html_url: `https://github.com/${name}/actions/runs/${job.runId}/job/${job.id}`,
  });

  /** A branch name or a commit id, as GitHub accepts either for a ref. */
  const resolveRef = (repo: FakeRepo, ref: string): string | undefined => repo.branches.get(ref)
    ?? (repo.commits.some((commit) => commit.sha === ref) || [...repo.checkRuns.keys()].includes(ref) ? ref : undefined);

  function recordItem(repo: FakeRepo, name: string, number: number): FakeItem | undefined {
    void name;
    return repo.items.get(number);
  }

  // ---- Search ------------------------------------------------------------------------------------------------------------

  function parseQuery(query: string): { terms: string[]; qualifiers: Map<string, string[]> } {
    const qualifiers = new Map<string, string[]>();
    const terms: string[] = [];
    for (const match of query.matchAll(/(\w+):"((?:[^"\\]|\\.)*)"|(\w+):(\S+)|"((?:[^"\\]|\\.)*)"|(\S+)/gu)) {
      const qualifier = match[1] ?? match[3];
      const value = (match[2] ?? match[4] ?? match[5] ?? match[6] ?? '').replaceAll('\\"', '"').replaceAll('\\\\', '\\');
      if (qualifier) qualifiers.set(qualifier, [...(qualifiers.get(qualifier) ?? []), value]);
      else if (value) terms.push(value.toLowerCase());
    }
    return { terms, qualifiers };
  }

  function searchIssues(url: URL): Response {
    const { terms, qualifiers } = parseQuery(url.searchParams.get('q') ?? '');
    const target = qualifiers.get('repo')?.[0];
    const repo = target ? repos.get(key(target)) : undefined;
    if (!repo || !target) return invalid('The search needs a repo: qualifier for a repository the app can read.');
    const kinds = qualifiers.get('is') ?? [];
    const labelFilter = qualifiers.get('label') ?? [];
    const author = qualifiers.get('author')?.[0];
    const matches = [...repo.items.values()].filter((item) => {
      if (kinds.includes('issue') && item.pull) return false;
      if (kinds.includes('pr') && !item.pull) return false;
      if (kinds.includes('open') && item.state !== 'open') return false;
      if (kinds.includes('closed') && item.state !== 'closed') return false;
      if (labelFilter.some((label) => !item.labels.some((own) => own.toLowerCase() === label.toLowerCase()))) return false;
      if (author && item.user.toLowerCase() !== author.toLowerCase()) return false;
      const haystack = `${item.title}\n${item.body}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    }).sort((left, right) => right.number - left.number);
    return json(200, { total_count: matches.length, incomplete_results: false, items: page(matches, url).map((item) => issueJson(target, item)) });
  }

  function searchCode(url: URL): Response {
    const { terms, qualifiers } = parseQuery(url.searchParams.get('q') ?? '');
    const target = qualifiers.get('repo')?.[0];
    const repo = target ? repos.get(key(target)) : undefined;
    if (!repo || !target) return invalid('The search needs a repo: qualifier for a repository the app can read.');
    const directory = qualifiers.get('path')?.[0];
    const found = [...repo.files].filter(([path, content]) => (!directory || path.startsWith(directory))
      && terms.every((term) => content.toLowerCase().includes(term))).map(([path, content]) => ({
      name: path.split('/').at(-1), path, sha: blobSha(content),
      html_url: `https://github.com/${target}/blob/${repo.defaultBranch}/${path}`, repository: { full_name: target },
    }));
    return json(200, { total_count: found.length, incomplete_results: false, items: page(found, url) });
  }

  // ---- GraphQL (linked issues, review threads, ready for review) ----------------------------------------------------------

  function graphql(body: unknown): Response {
    const request = object(body);
    const query = text(request?.query) ?? '';
    const variables = object(request?.variables) ?? {};
    if (query.includes('markPullRequestReadyForReview')) {
      for (const repo of repos.values()) {
        for (const item of repo.items.values()) {
          if (item.pull && `PR_node_${item.number}` === variables.id) {
            item.pull.draft = false;
            return json(200, { data: { markPullRequestReadyForReview: { pullRequest: { number: item.number, isDraft: false } } } });
          }
        }
      }
      return json(200, { errors: [{ message: 'Could not resolve to a node with the global id.' }] });
    }
    const target = `${text(variables.owner) ?? ''}/${text(variables.name) ?? ''}`;
    const repo = repos.get(key(target));
    const item = repo?.items.get(Number(variables.number));
    if (!repo || !item?.pull) return json(200, { errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a PullRequest.' }] });
    if (query.includes('closingIssuesReferences')) {
      return json(200, { data: { repository: { pullRequest: { closingIssuesReferences: {
        nodes: item.pull.closes.flatMap((number) => {
          const issue = repo.items.get(number);
          return issue ? [{ number, title: issue.title, state: issue.state.toUpperCase(), repository: { nameWithOwner: repo.fullName } }] : [];
        }),
        pageInfo: { hasNextPage: false },
      } } } } });
    }
    if (query.includes('reviewThreads')) {
      return json(200, { data: { repository: { pullRequest: { reviewThreads: {
        nodes: item.pull.threads.map((thread) => ({
          isResolved: thread.resolved, path: thread.path, line: thread.line,
          comments: { nodes: thread.comments.map((comment) => ({ author: { login: comment.author }, body: comment.body, createdAt: comment.createdAt })), pageInfo: { hasNextPage: false } },
        })),
        pageInfo: { hasNextPage: false },
      } } } } });
    }
    return json(200, { errors: [{ message: 'This conformance GitHub does not know that query.' }] });
  }

  // ---- Repository routes -------------------------------------------------------------------------------------------------

  function putContents(repo: FakeRepo, path: string, body: Json): Response {
    const branch = text(body.branch) ?? repo.defaultBranch;
    const message = text(body.message);
    const encoded = text(body.content);
    if (!message || encoded === undefined) return invalid('A commit message and base64 content are needed.');
    if (!repo.branches.has(branch)) return notFound();
    const existing = repo.files.get(path);
    if (existing !== undefined) {
      if (!text(body.sha)) return invalid('"sha" wasn\'t supplied.');
      if (body.sha !== blobSha(existing)) return json(409, { message: `${path} does not match ${String(body.sha)}` });
    }
    const content = Buffer.from(encoded, 'base64').toString('utf8');
    repo.files.set(path, content);
    const commit = sha(0x900 + repo.commits.length);
    repo.commits.unshift({ sha: commit, message, author: 'Jarvis', date: timestamps.now, files: [{ filename: path, status: existing === undefined ? 'added' : 'modified', additions: content.split('\n').length, deletions: 0 }] });
    repo.branches.set(branch, commit);
    return json(existing === undefined ? 201 : 200, {
      content: { path, sha: blobSha(content), html_url: `https://github.com/${repo.fullName}/blob/${branch}/${path}` },
      commit: { sha: commit, html_url: `https://github.com/${repo.fullName}/commit/${commit}` },
    });
  }

  function getContents(repo: FakeRepo, path: string): Response {
    const content = repo.files.get(path);
    if (content !== undefined) {
      return json(200, {
        type: 'file', name: path.split('/').at(-1), path, sha: blobSha(content), size: Buffer.byteLength(content), encoding: 'base64',
        content: wrapBase64(content), html_url: `https://github.com/${repo.fullName}/blob/${repo.defaultBranch}/${path}`,
      });
    }
    const children = childrenOf(repo, path);
    return children.length > 0 || path === '' ? json(200, children) : notFound();
  }

  function repoRoute(repo: FakeRepo, name: string, method: string, rest: string, url: URL, body: unknown): Response {
    const input = object(body) ?? {};
    let match: RegExpExecArray | null;

    if (rest === '' && method === 'GET') {
      return json(200, { full_name: name, name: name.split('/')[1], default_branch: repo.defaultBranch, private: repo.isPrivate, html_url: `https://github.com/${name}` });
    }
    // Contents, refs and trees
    if ((match = /^\/contents(?:\/(.*))?$/u.exec(rest))) {
      const path = decodeURIComponent(match[1] ?? '').replace(/\/$/u, '');
      if (method === 'GET') return getContents(repo, path);
      if (method === 'PUT') return putContents(repo, path, input);
    }
    if (method === 'GET' && (match = /^\/git\/ref\/heads\/(.+)$/u.exec(rest))) {
      const branch = decodeURIComponent(match[1]!);
      const head = repo.branches.get(branch);
      return head ? json(200, { ref: `refs/heads/${branch}`, object: { sha: head, type: 'commit' } }) : notFound();
    }
    if (method === 'GET' && (match = /^\/git\/trees\/([0-9a-f]{40})$/u.exec(rest))) {
      return json(200, {
        sha: match[1], truncated: false,
        tree: childrenOf(repo, '').map((entry) => ({ path: entry.name, mode: entry.type === 'dir' ? '040000' : '100644', type: entry.type === 'dir' ? 'tree' : 'blob', sha: entry.sha, ...(entry.type === 'file' ? { size: entry.size } : {}) })),
      });
    }
    if (method === 'POST' && rest === '/git/refs') {
      const ref = text(input.ref);
      const target = text(input.sha);
      if (!ref?.startsWith('refs/heads/') || !target) return invalid('A ref and a sha are needed.');
      const branch = ref.slice('refs/heads/'.length);
      if (repo.branches.has(branch)) return invalid('Reference already exists');
      if (!repo.commits.some((commit) => commit.sha === target)) return json(422, { message: 'Object does not exist' });
      repo.branches.set(branch, target);
      return json(201, { ref, object: { sha: target, type: 'commit' } });
    }
    // Branches, commits, checks, comparison
    if (method === 'GET' && rest === '/branches') {
      return json(200, page([...repo.branches].map(([branch, head]) => ({ name: branch, commit: { sha: head }, protected: branch === repo.defaultBranch })), url));
    }
    if (method === 'GET' && (match = /^\/commits\/([^/]+)\/check-runs$/u.exec(rest))) {
      const ref = resolveRef(repo, decodeURIComponent(match[1]!));
      if (!ref) return notFound();
      const runs = repo.checkRuns.get(ref) ?? [];
      return json(200, { total_count: runs.length, check_runs: runs.map((run) => ({ id: run.id, name: run.name, status: run.status, conclusion: run.conclusion, check_suite: { id: run.suiteId } })) });
    }
    if (method === 'GET' && (match = /^\/commits\/([^/]+)\/status$/u.exec(rest))) {
      return resolveRef(repo, decodeURIComponent(match[1]!)) ? json(200, { state: 'success', statuses: [], total_count: 0 }) : notFound();
    }
    if (method === 'GET' && rest === '/commits') {
      const ref = url.searchParams.get('sha');
      if (ref && !resolveRef(repo, ref)) return notFound();
      return json(200, page(repo.commits, url).map((commit) => ({
        sha: commit.sha, html_url: `https://github.com/${name}/commit/${commit.sha}`, commit: { message: commit.message, author: { name: commit.author, date: commit.date } },
      })));
    }
    if (method === 'GET' && (match = /^\/commits\/([0-9a-f]{40})$/u.exec(rest))) {
      const commit = repo.commits.find((candidate) => candidate.sha === match![1]);
      return commit ? json(200, {
        sha: commit.sha, html_url: `https://github.com/${name}/commit/${commit.sha}`, commit: { message: commit.message, author: { name: commit.author, date: commit.date } }, files: commit.files,
      }) : notFound();
    }
    if (method === 'GET' && (match = /^\/compare\/(.+?)\.\.\.(.+)$/u.exec(rest))) {
      const base = resolveRef(repo, decodeURIComponent(match[1]!));
      const head = resolveRef(repo, decodeURIComponent(match[2]!));
      if (!base || !head) return notFound();
      const ahead = base === head ? [] : repo.commits.filter((commit) => commit.sha === head);
      return json(200, {
        status: ahead.length > 0 ? 'ahead' : 'identical', ahead_by: ahead.length, behind_by: 0,
        commits: ahead.map((commit) => ({ sha: commit.sha, commit: { message: commit.message } })),
        files: ahead.flatMap((commit) => commit.files),
      });
    }
    // Issues
    if (method === 'GET' && rest === '/issues') {
      const state = url.searchParams.get('state') ?? 'open';
      const entries = [...repo.items.values()].filter((item) => state === 'all' || item.state === state).sort((left, right) => left.number - right.number);
      return json(200, page(entries, url).map((item) => issueJson(name, item)));
    }
    if (method === 'POST' && rest === '/issues') {
      const title = text(input.title);
      if (!title) return invalid('title is missing');
      const number = repo.nextNumber;
      repo.nextNumber += 1;
      const item: FakeItem = {
        number, title, body: text(input.body) ?? '', state: 'open', stateReason: null, labels: strings(input.labels), assignees: strings(input.assignees),
        user: 'jarvis-app[bot]', milestone: null, comments: [], createdAt: timestamps.now, updatedAt: timestamps.now, closedAt: null,
      };
      repo.items.set(number, item);
      return json(201, issueJson(name, item));
    }
    if ((match = /^\/issues\/(\d+)(\/comments|\/labels(?:\/(.+))?)?$/u.exec(rest))) {
      const item = recordItem(repo, name, Number(match[1]));
      if (!item) return notFound();
      const sub = match[2];
      if (!sub) {
        if (method === 'GET') return json(200, issueJson(name, item));
        if (method === 'PATCH') {
          if (typeof input.title === 'string') item.title = input.title;
          if (typeof input.body === 'string') item.body = input.body;
          if (input.state === 'open' || input.state === 'closed') {
            item.state = input.state;
            item.closedAt = input.state === 'closed' ? timestamps.now : null;
            item.stateReason = input.state === 'closed' ? text(input.state_reason) ?? 'completed' : null;
          }
          if (Array.isArray(input.labels)) item.labels = strings(input.labels);
          if (Array.isArray(input.assignees)) item.assignees = strings(input.assignees);
          if ('milestone' in input) item.milestone = typeof input.milestone === 'number' ? input.milestone : null;
          item.updatedAt = timestamps.now;
          return json(200, issueJson(name, item));
        }
      } else if (sub === '/comments') {
        if (method === 'GET') return json(200, page(item.comments, url).map((comment) => commentJson(name, item, comment)));
        if (method === 'POST') {
          const bodyText = text(input.body);
          if (!bodyText) return invalid('body is missing');
          repo.nextId += 1;
          const comment: FakeComment = { id: repo.nextId, user: 'jarvis-app[bot]', body: bodyText, createdAt: timestamps.now };
          item.comments.push(comment);
          return json(201, commentJson(name, item, comment));
        }
      } else if (method === 'POST') {
        for (const label of strings(input.labels)) if (!item.labels.includes(label)) item.labels.push(label);
        return json(200, item.labels.map((label) => ({ name: label, color: 'ededed' })));
      } else if (method === 'DELETE' && match[3]) {
        const label = decodeURIComponent(match[3]);
        if (!item.labels.includes(label)) return notFound();
        item.labels = item.labels.filter((own) => own !== label);
        return json(200, item.labels.map((own) => ({ name: own, color: 'ededed' })));
      }
    }
    // Labels and milestones
    if (method === 'GET' && rest === '/labels') return json(200, page([...repo.labels.values()], url));
    if (method === 'POST' && rest === '/labels') {
      const label = text(input.name);
      if (!label) return invalid('name is missing');
      if (repo.labels.has(label.toLowerCase())) return invalid('already_exists');
      const created = { name: label, color: text(input.color) ?? 'ededed', description: text(input.description) ?? '' };
      repo.labels.set(label.toLowerCase(), created);
      return json(201, created);
    }
    if (method === 'GET' && rest === '/milestones') {
      const state = url.searchParams.get('state') ?? 'open';
      return json(200, page(repo.milestones.filter((milestone) => state === 'all' || milestone.state === state), url)
        .map((milestone) => ({ number: milestone.number, title: milestone.title, state: milestone.state, due_on: milestone.dueOn })));
    }
    // Pull requests
    if (method === 'GET' && rest === '/pulls') {
      const state = url.searchParams.get('state') ?? 'open';
      const entries = [...repo.items.values()].filter((item) => item.pull && (state === 'all' || item.state === state)).sort((left, right) => right.number - left.number);
      return json(200, page(entries, url).map((item) => pullJson(name, item)));
    }
    if (method === 'POST' && rest === '/pulls') {
      const title = text(input.title);
      const head = text(input.head);
      const base = text(input.base);
      if (!title || !head || !base) return invalid('title, head and base are needed');
      const headSha = repo.branches.get(head);
      if (!headSha || !repo.branches.has(base)) return invalid('head or base is not a branch of this repository');
      const number = repo.nextNumber;
      repo.nextNumber += 1;
      const item: FakeItem = {
        number, title, body: text(input.body) ?? '', state: 'open', stateReason: null, labels: [], assignees: [], user: 'jarvis-app[bot]', milestone: null,
        comments: [], createdAt: timestamps.now, updatedAt: timestamps.now, closedAt: null,
        pull: { head: { ref: head, sha: headSha }, base: { ref: base }, draft: input.draft === true, merged: false, mergeSha: null, mergeable: true, closes: [], files: [], reviewComments: [], threads: [] },
      };
      repo.items.set(number, item);
      return json(201, pullJson(name, item));
    }
    if ((match = /^\/pulls\/(\d+)(\/files|\/comments|\/reviews|\/merge)?$/u.exec(rest))) {
      const item = repo.items.get(Number(match[1]));
      if (!item?.pull) return notFound();
      const pull = item.pull;
      const sub = match[2];
      if (!sub) {
        if (method === 'GET') return json(200, pullJson(name, item));
        if (method === 'PATCH') {
          if (typeof input.title === 'string') item.title = input.title;
          if (typeof input.body === 'string') item.body = input.body;
          if (input.state === 'open' || input.state === 'closed') { item.state = input.state; item.closedAt = input.state === 'closed' ? timestamps.now : null; }
          if (typeof input.base === 'string') pull.base = { ref: input.base };
          item.updatedAt = timestamps.now;
          return json(200, pullJson(name, item));
        }
      } else if (sub === '/files' && method === 'GET') {
        return json(200, page(pull.files, url));
      } else if (sub === '/comments' && method === 'GET') {
        return json(200, page(pull.reviewComments, url).map((comment) => ({
          id: comment.id, user: { login: comment.user }, body: comment.body, created_at: comment.createdAt, path: comment.path, line: comment.line,
        })));
      } else if (sub === '/reviews' && method === 'POST') {
        if (!['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes(String(input.event))) return invalid('event is invalid');
        repo.nextId += 1;
        return json(200, { id: repo.nextId, state: String(input.event), html_url: `${issueUrl(name, item)}#pullrequestreview-${repo.nextId}` });
      } else if (sub === '/merge' && method === 'PUT') {
        if (item.state !== 'open' || pull.merged) return json(405, { message: 'Pull Request is not mergeable' });
        if (pull.draft) return json(405, { message: 'Draft pull requests cannot be merged' });
        if (input.sha !== pull.head.sha) return json(409, { message: 'Head branch was modified. Review and try the merge again.' });
        pull.merged = true;
        pull.mergeSha = sha(0xa00 + item.number);
        item.state = 'closed';
        item.closedAt = timestamps.now;
        repo.branches.set(pull.base.ref, pull.mergeSha);
        repo.commits.unshift({ sha: pull.mergeSha, message: `Merge pull request #${item.number}`, author: 'Dan Aakesen', date: timestamps.now, files: [] });
        return json(200, { merged: true, sha: pull.mergeSha, message: 'Pull Request successfully merged' });
      }
    }
    // GitHub Actions
    if (method === 'GET' && rest === '/actions/runs') {
      const branch = url.searchParams.get('branch');
      const head = url.searchParams.get('head_sha');
      const status = url.searchParams.get('status');
      const runs = repo.runs.filter((run) => (!branch || run.branch === branch) && (!head || run.sha === head) && (!status || run.status === status || run.conclusion === status));
      return json(200, { total_count: runs.length, workflow_runs: page(runs, url).map((run) => runJson(name, run)) });
    }
    if ((match = /^\/actions\/runs\/(\d+)(\/jobs|\/rerun)?$/u.exec(rest))) {
      const run = repo.runs.find((candidate) => candidate.id === Number(match![1]));
      if (!run) return notFound();
      if (!match[2] && method === 'GET') return json(200, runJson(name, run));
      if (match[2] === '/jobs' && method === 'GET') {
        const jobs = repo.jobs.filter((job) => job.runId === run.id);
        return json(200, { total_count: jobs.length, jobs: page(jobs, url).map((job) => jobJson(name, job)) });
      }
      if (match[2] === '/rerun' && method === 'POST') return json(201, {});
    }
    if ((match = /^\/actions\/jobs\/(\d+)(\/logs)?$/u.exec(rest)) && method === 'GET') {
      const job = repo.jobs.find((candidate) => candidate.id === Number(match![1]));
      if (!job) return notFound();
      if (!match[2]) return json(200, jobJson(name, job));
      return new Response(null, { status: 302, headers: { location: `https://${'pipelines.actions.githubusercontent.com'}/${repo.fullName}/job/${job.id}/logs.zip` } });
    }
    if (method === 'POST' && (match = /^\/actions\/workflows\/([^/]+)\/dispatches$/u.exec(rest))) {
      const ref = text(input.ref);
      if (!ref || !repo.branches.has(ref)) return invalid('No ref found for the dispatch');
      repo.dispatched.push({ workflow: decodeURIComponent(match[1]!), ref });
      return empty(204);
    }
    return notFound();
  }

  function logArchive(url: URL): Response {
    const match = /^\/([^/]+\/[^/]+)\/job\/(\d+)\/logs\.zip$/u.exec(url.pathname);
    const job = match ? repos.get(key(match[1]!))?.jobs.find((candidate) => candidate.id === Number(match[2])) : undefined;
    if (!job) return notFound();
    return new Response(Buffer.from(zipSync({ [`${job.id}_${job.name.replace(/\W+/gu, '-')}.txt`]: strToU8(job.log) })), { status: 200, headers: { 'content-type': 'application/zip' } });
  }

  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === 'api.github.com') {
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (!/^Bearer \S+$/u.test(new Headers(init?.headers).get('authorization') ?? '')) return json(401, { message: 'Requires authentication' });
      let body: unknown;
      try { body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : undefined; } catch { return json(400, { message: 'Problems parsing JSON' }); }
      if (url.pathname === '/graphql' && method === 'POST') return graphql(body);
      if (url.pathname === '/search/issues') return searchIssues(url);
      if (url.pathname === '/search/code') return searchCode(url);
      const match = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/u.exec(url.pathname);
      if (!match) return notFound();
      const name = `${decodeURIComponent(match[1]!)}/${decodeURIComponent(match[2]!)}`;
      const repo = repos.get(key(name));
      return repo ? repoRoute(repo, name, method, match[3] ?? '', url, body) : notFound();
    }
    if (url.hostname === 'pipelines.actions.githubusercontent.com') return logArchive(url);
    const next = options.delegate();
    if (!next) throw new Error(`The conformance suite blocks network calls: nothing stubs ${url.origin}.`);
    return next(input, init);
  };

  return { fetch: fake as typeof fetch, repos, repository, addRepository };
}
