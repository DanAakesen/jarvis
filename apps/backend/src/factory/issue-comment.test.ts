import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { GitHubAppTokenIssuer } from '../github-app.js';
import { createGitHubIssueClient } from '../github/issues.js';
import { ToolFailure, ToolRefusal } from '../core/tool-registry.js';
import { factoryTools } from './tools.js';

const issueComment = factoryTools.find(({ name }) => name === 'issue_comment')!;
const issue = { number: 12, url: 'https://github.com/DanAakesen/jarvis/issues/12', title: 'Slow search', body: 'Searching takes ages.' };
const never = new AbortController().signal;
const caught = (work: Promise<unknown>) => work.then(() => undefined, (error: unknown) => error);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

/**
 * GitHub as the real issue client sees it, over fetch: it keeps every comment it is sent. `lostReplies` posts land, but their answer
 * never arrives; `badGateway` posts land and GitHub answers 502; `refuse` posts are refused (422).
 */
function githubWith(options: { lostReplies?: number; refuse?: number; badGateway?: number } = {}) {
  const comments: { author: string; body: string }[] = [];
  const state = { attempts: 0, lostReplies: options.lostReplies ?? 0, refuse: options.refuse ?? 0, badGateway: options.badGateway ?? 0 };
  const github = (async (input: string | URL | Request, init?: RequestInit) => {
    const { pathname, searchParams } = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (pathname === '/repos/DanAakesen/jarvis/issues/12' && method === 'GET') {
      return json({ number: 12, title: issue.title, body: issue.body, state: 'open', html_url: issue.url, labels: [] });
    }
    if (pathname === '/repos/DanAakesen/jarvis/issues/12/comments' && method === 'GET') {
      return json(searchParams.get('page') === '1' ? comments.map(({ author, body }) => ({ user: { login: author }, body })) : []);
    }
    if (pathname === '/repos/DanAakesen/jarvis/issues/12/comments' && method === 'POST') {
      state.attempts += 1;
      if (state.refuse > 0) { state.refuse -= 1; return json({ message: 'Validation Failed' }, 422); }
      comments.push({ author: 'jarvis', body: (JSON.parse(String(init?.body)) as { body: string }).body });
      if (state.badGateway > 0) { state.badGateway -= 1; return json({}, 502); }
      if (state.lostReplies > 0) { state.lostReplies -= 1; throw new TypeError('fetch failed'); }
      return json({ id: comments.length }, 201);
    }
    return json({}, 404);
  }) as typeof fetch;
  const tokens = { issueForRepositoryRead: async () => 'read-token', issueForIssuesWrite: async () => 'write-token' } as unknown as GitHubAppTokenIssuer;
  return { comments, state, client: createGitHubIssueClient(tokens, github) };
}

/** One backend process. The in-process receipts belong to its server, so a new one is a restart. */
function backend(github: ReturnType<typeof githubWith>, sessionId = 'session-1') {
  const server = {
    githubIssueClient: github.client,
    githubAppTokenIssuer: { readInstallationPermissions: async () => ({ issues: 'write' }) },
  };
  return (messageId: string, text: string) => issueComment.execute(
    { issueNumber: 12, text },
    {
      headers: {}, principal: {}, server,
      jarvisConversationMessage: { id: messageId, sessionId, role: 'dan', text: 'Comment on issue 12.', model: null, at: new Date() },
    } as unknown as FastifyRequest,
    never,
  );
}

describe('issue_comment, asked twice by one instruction', () => {
  it('posts the comment once when the same call is repeated', async () => {
    const github = githubWith();
    const comment = backend(github);
    const first = await comment('101', 'The search is slow on mobile.');
    expect(await comment('101', 'The search is slow on mobile.')).toEqual(first);
    expect(first).toMatchObject({ status: 'commented', number: 12 });
    expect(github.state.attempts).toBe(1);
  });

  it('posts it once when two identical calls arrive together', async () => {
    const github = githubWith();
    const comment = backend(github);
    await Promise.all([comment('101', 'Same words.'), comment('101', 'Same words.')]);
    expect(github.state.attempts).toBe(1);
  });

  it('finds its earlier comment on the issue after a restart', async () => {
    const github = githubWith();
    await backend(github)('101', 'The search is slow on mobile.');
    const again = await backend(github)('101', 'The search is slow on mobile.');
    expect(again).toMatchObject({ status: 'commented', alreadyPosted: true });
    expect(github.state.attempts).toBe(1);
  });

  it('does not post a second time when the reply to the first post was lost', async () => {
    const github = githubWith({ lostReplies: 1 });
    const comment = backend(github);
    const lost = await caught(comment('101', 'The search is slow on mobile.'));
    expect(lost).toBeInstanceOf(ToolFailure);
    expect((lost as Error).message).toMatch(/not posted twice/u);
    expect(await comment('101', 'The search is slow on mobile.')).toMatchObject({ status: 'commented', alreadyPosted: true });
    expect(github.comments).toHaveLength(1);
  });

  it('does not post a second time when GitHub answered 502 after it stored the comment', async () => {
    const github = githubWith({ badGateway: 1 });
    const comment = backend(github);
    const unsure = await caught(comment('101', 'The search is slow on mobile.'));
    expect(unsure).toBeInstanceOf(ToolFailure);
    expect(unsure).toMatchObject({ outcomeUnknown: true });
    expect((unsure as Error).message).toMatch(/not posted twice/u);
    expect(await comment('101', 'The search is slow on mobile.')).toMatchObject({ status: 'commented', alreadyPosted: true });
    expect(github.comments).toHaveLength(1);
  });

  it('tries again when GitHub refused the first attempt', async () => {
    const github = githubWith({ refuse: 1 });
    const comment = backend(github);
    const refused = await caught(comment('101', 'The search is slow on mobile.'));
    expect((refused as Error).message).toBe('I couldn’t post the GitHub issue comment.');
    expect(refused).toMatchObject({ outcomeUnknown: false });
    expect(await comment('101', 'The search is slow on mobile.')).toMatchObject({ status: 'commented' });
    expect(github.comments).toHaveLength(1);
    expect(github.state.attempts).toBe(2);
  });

  it('still posts a different comment, and the same words under a new instruction', async () => {
    const github = githubWith();
    const comment = backend(github);
    await comment('101', 'First thought.');
    await comment('101', 'Second thought.');
    await comment('102', 'First thought.');
    expect(github.comments).toHaveLength(3);
  });

  it('keeps Dan’s words first and ends the comment with an invisible marker', async () => {
    const github = githubWith();
    await backend(github)('101', 'The search is slow on mobile.');
    const { body } = github.comments[0]!;
    expect(body.startsWith('The search is slow on mobile.\n\n<!-- jarvis-comment:session-1:101:')).toBe(true);
    expect(body.endsWith('-->')).toBe(true);
  });
});

describe('issue_comment at the 4,000-character limit', () => {
  // The longest marker the backend can write: a UUID session and the largest message id.
  const sessionId = '123e4567-e89b-42d3-a456-426614174000';
  const messageId = '9223372036854775807';
  const words = (length: number) => `${'The search is slow on mobile. '.repeat(Math.ceil(length / 30)).slice(0, length - 1)}.`;

  it.each([3_990, 4_000])('posts %i characters once, with its marker on top, and a retry finds it', async (length) => {
    const github = githubWith();
    const text = words(length);
    expect(text).toHaveLength(length);

    expect(await backend(github, sessionId)(messageId, text)).toMatchObject({ status: 'commented', number: 12 });
    expect(github.comments).toHaveLength(1);
    expect(github.comments[0]!.body.startsWith(`${text}\n\n<!-- jarvis-comment:${sessionId}:${messageId}:`)).toBe(true);

    // The same instruction after a restart: the marker on the issue answers it.
    expect(await backend(github, sessionId)(messageId, text)).toMatchObject({ status: 'commented', alreadyPosted: true });
    expect(github.comments).toHaveLength(1);
    expect(github.state.attempts).toBe(1);
  });

  it('refuses a comment with no words in it, before anything is sent, so the marker alone is never posted', async () => {
    const github = githubWith();
    const refused = await caught(backend(github)('101', '   \n  '));
    expect(refused).toBeInstanceOf(ToolRefusal);
    expect((refused as Error).message).toBe('The comment has no words to post. Nothing was posted.');
    expect(github.state.attempts).toBe(0);
  });
});
