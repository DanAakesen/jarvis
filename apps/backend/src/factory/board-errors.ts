import { GitHubAppRequestError, GitHubAppResponseError } from '../github-app.js';

type BoardStage = 'project' | 'token' | 'source' | 'task' | 'release' | 'response';
type BoardReason = 'request_failed' | 'timeout' | 'cancelled' | 'transport_failed' |
  'invalid_response' | 'response_too_large' | 'result_limit' | 'incomplete_response' |
  'invalid_token_lifetime' | 'invalid_token_permissions' | 'unexpected';

export class FactoryBoardReadError extends Error {
  readonly status: number | undefined;

  constructor(readonly stage: BoardStage, readonly reason: BoardReason, status?: number) {
    super(reason === 'result_limit' ? 'GitHub board result limit exceeded'
      : reason === 'invalid_response' ? 'GitHub board response is invalid'
        : reason === 'incomplete_response' ? 'GitHub board response is incomplete'
          : reason === 'response_too_large' ? 'GitHub board response is too large'
            : 'Factory board read failed');
    this.status = Number.isInteger(status) && status! >= 100 && status! <= 599 ? status : undefined;
  }
}

export function boardReadError(stage: BoardStage, error: unknown): FactoryBoardReadError {
  if (error instanceof FactoryBoardReadError) return error;
  if (error instanceof GitHubAppRequestError) {
    return new FactoryBoardReadError(stage, 'request_failed', error.status);
  }
  if (error instanceof GitHubAppResponseError) {
    return new FactoryBoardReadError(stage, error.reason);
  }
  const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timeout'
    : error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'unexpected';
  return new FactoryBoardReadError(stage, reason);
}

export async function readBoardStage<T>(stage: BoardStage, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw boardReadError(stage, error);
  }
}
