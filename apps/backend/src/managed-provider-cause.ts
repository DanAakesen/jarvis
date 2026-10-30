export interface ManagedProviderCause {
  readonly httpStatus?: number;
  readonly code?: string;
  readonly param?: string;
  readonly exceptionType?: string;
}

export function sanitizeManagedProviderCause(value: unknown): ManagedProviderCause | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const cause: { httpStatus?: number; code?: string; param?: string; exceptionType?: string } = {};
  if (typeof input.httpStatus === 'number' && Number.isInteger(input.httpStatus) &&
      input.httpStatus >= 100 && input.httpStatus <= 599) cause.httpStatus = input.httpStatus;
  for (const key of ['code', 'param'] as const) {
    const field = input[key];
    if (typeof field === 'string' && /^[a-z0-9_.]{1,48}$/u.test(field) && !field.includes('\n')) cause[key] = field;
  }
  if (typeof input.exceptionType === 'string' &&
      /^[A-Za-z_][A-Za-z0-9_]{0,47}$/u.test(input.exceptionType) &&
      !input.exceptionType.includes('\n')) cause.exceptionType = input.exceptionType;
  return Object.keys(cause).length ? cause : undefined;
}
