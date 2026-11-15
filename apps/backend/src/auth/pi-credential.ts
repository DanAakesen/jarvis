import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AgentPrincipal } from './verify.js';

export const piMcpPath = '/pi/mcp';
export const piMcpPrefix = 'jp.';
const piMcpToken = /^jp\.([A-Za-z0-9_-]{43,128})$/u;

/** The synthetic identity of Jarvis tool calls that the PI MCP server dispatches inside this process. */
export const piDispatchObjectId = '00000000-0000-4000-8000-00000000f1a1';

export interface PiAuth {
  /** Static credential the managed agent presents to the MCP route; absent means the route refuses everyone. */
  readonly mcpSecret?: string | undefined;
  /**
   * Random per process and never leaves it. The MCP server presents it on the tool calls it dispatches itself, so the
   * normal tool routes (validation, approvals, receipts, activity) run unchanged. No network caller can know it.
   */
  readonly dispatch: { readonly token: string; readonly principal: AgentPrincipal };
}

export function createPiAuth(tenantId: string, mcpSecret?: string): PiAuth {
  // Shaped like a JWT so it passes the same bearer parsing as every other token, then matched before any verifier.
  const part = (bytes: number) => randomBytes(bytes).toString('base64url');
  return {
    mcpSecret,
    dispatch: {
      token: `${part(9)}.${part(9)}.${part(32)}`,
      principal: { kind: 'jarvis-agent', objectId: piDispatchObjectId, tenantId },
    },
  };
}

/** The secret part of a PI MCP credential, or undefined when the header is not one. */
export function piMcpCredential(header: unknown): string | undefined {
  return typeof header === 'string' && header.length <= 160 && /^Bearer /iu.test(header)
    ? piMcpToken.exec(header.slice(7))?.[1] : undefined;
}

/** Constant-time comparison for the static MCP credential and the in-process dispatch token. */
export function secretsMatch(expected: string, presented: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}
