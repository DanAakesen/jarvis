import { failureCopy, type FailureKind } from '@jarvis/contracts';

export type PiErrorCode =
  | 'pi_not_configured' | 'pi_budget_exhausted' | 'pi_unavailable' | 'pi_timeout' | 'pi_failed' | 'pi_unsupported';

/**
 * A failure with fixed, plain words for Dan (`userMessage` in Chat, `spokenMessage` in Voice; the same words, from `failureCopy` in
 * `@jarvis/contracts`, so a failure reads and sounds alike). Provider text never reaches them. The stable `code` and the sanitised
 * `detail` stay on the error for the log, the smoke and diagnostics.
 */
export class PiGatewayError extends Error {
  readonly userMessage: string;
  readonly spokenMessage: string;
  readonly detail: string | undefined;
  /** A final message backed by actual tool results, not an error string or model reply. Keep it out of diagnostics. */
  readonly receipt: string | undefined;
  /**
   * `detail` names the technical cause for the log and is never shown: the provider's own short error code, an HTTP answer as
   * `http_<status>`, or one of the gateway's own stream reasons (letters, digits and `_.:-` only).
   */
  constructor(readonly code: PiErrorCode, readonly kind: FailureKind, options?: ErrorOptions & {
    readonly detail?: string | undefined; readonly receipt?: string;
  }) {
    super(`PI gateway failed (${code}${options?.detail ? `: ${options.detail}` : ''})`, options);
    this.name = 'PiGatewayError';
    this.userMessage = failureCopy[kind].chat;
    this.spokenMessage = options?.receipt ?? failureCopy[kind].voice;
    this.detail = options?.detail;
    this.receipt = options?.receipt;
  }
}
