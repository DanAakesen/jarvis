export type PiErrorCode =
  | 'pi_not_configured' | 'pi_budget_exhausted' | 'pi_unavailable' | 'pi_timeout' | 'pi_failed' | 'pi_unsupported';

/** A failure with a fixed, honest message for Dan. Provider text never reaches it. */
export class PiGatewayError extends Error {
  constructor(readonly code: PiErrorCode, readonly userMessage: string, options?: ErrorOptions) {
    super(`PI gateway failed (${code})`, options);
    this.name = 'PiGatewayError';
  }
}
