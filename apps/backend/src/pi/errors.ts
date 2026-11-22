export type PiErrorCode =
  | 'pi_not_configured' | 'pi_budget_exhausted' | 'pi_unavailable' | 'pi_timeout' | 'pi_failed' | 'pi_unsupported';

/** A failure with a fixed, honest message for Dan. Provider text never reaches it. */
export class PiGatewayError extends Error {
  readonly detail: string | undefined;
  /** `detail` is the provider's own short error code (letters, digits and `_.:-` only), when it sent one. It names the failure for the log and the smoke. */
  constructor(readonly code: PiErrorCode, readonly userMessage: string, options?: ErrorOptions & { readonly detail?: string | undefined }) {
    super(`PI gateway failed (${code})`, options);
    this.name = 'PiGatewayError';
    this.detail = options?.detail;
  }
}

/** What Dan is told when a turn fails without a plain cause of its own. Chat shows it and Voice speaks it, so both say the same thing. */
export const piTurnFailedMessage = 'I could not finish the reply. A task action may still have completed; check its status before trying again.';
