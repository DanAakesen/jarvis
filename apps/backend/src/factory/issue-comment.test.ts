import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { ToolFailure } from '../core/tool-registry.js';
import { factoryTools } from './tools.js';

const issueComment = factoryTools.find(({ name }) => name === 'issue_comment')!;
const issue = { number: 12, url: 'https://github.com/DanAakesen/jarvis/issues/12', isPullRequest: false, state: 'open', title: 'Slow search', body: 'Searching takes ages.' };
const never = new AbortController().signal;
const caught = (work: Promise<unknown>) => work.then(() => undefined, (error: unknown) => error);

/** GitHub keeps every comment it is sent. `lostReplies` posts land, but their answer never arrives. */
function githubWith(options: { lostReplies?: number; refuse?: number } = {}) {
  const comments: { author: string; body: string }[] = [];
  const state = { attempts: 0, lostReplies: options.lostReplies ?? 0, refuse: options.refuse ?? 0 };
  return {
    comments, state,
    client: {
      readIssue: async () => issue,
      readComments: async () => comments,
      createComment: async (_repository: string, _issue: number, body: string) => {
        state.attempts += 1;
        if (state.refuse > 0) { state.refuse -= 1; throw Object.assign(new Error('GitHub issue request failed'), { status: 502 }); }
        comments.push({ author: 'jarvis', body });
        if (state.lostReplies > 0) { state.lostReplies -= 1; throw new TypeError('fetch failed'); }
      },
    },
  };
}

/** One backend process. The in-process receipts belong to its server, so a new one is a restart. */
function backend(github: ReturnType<typeof githubWith>) {
  const server = {
    githubIssueClient: github.client,
    githubAppTokenIssuer: { readInstallationPermissions: async () => ({ issues: 'write' }) },
  };
  return (messageId: string, text: string) => issueComment.execute(
    { issueNumber: 12, text },
    {
      headers: {}, principal: {}, server,
      jarvisConversationMessage: { id: messageId, sessionId: 'session-1', role: 'dan', text: 'Comment on issue 12.', model: null, at: new Date() },
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

  it('tries again when GitHub refused the first attempt', async () => {
    const github = githubWith({ refuse: 1 });
    const comment = backend(github);
    const refused = await caught(comment('101', 'The search is slow on mobile.'));
    expect((refused as Error).message).toBe('I couldn’t post the GitHub issue comment.');
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
