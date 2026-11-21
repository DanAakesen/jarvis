import { capabilityIndex } from '../core/capability-index.js';
import type { ToolRegistry } from '../core/tool-registry.js';
import type { RemoteMcpBridge } from './remote-mcp.js';
import { azureToolPrefix, githubToolPrefix } from './remote-mcp.js';

function connection(prefix: string, label: string, bridges: readonly RemoteMcpBridge[]) {
  const bridge = bridges.find(candidate => candidate.prefix === prefix);
  if (!bridge) return { name: label, state: 'not_configured' as const };
  const status = bridge.status();
  return status.state === 'unreachable' || status.state === 'stale'
    ? { name: bridge.label, state: status.state, reason: status.reason }
    : { name: bridge.label, state: status.state };
}

export function piConnectionInventory(bridges: readonly RemoteMcpBridge[]): readonly (
  | { readonly name: string; readonly state: 'ready' | 'idle' | 'starting' | 'not_configured' }
  | { readonly name: string; readonly state: 'unreachable' | 'stale'; readonly reason: string }
)[] {
  return [
    { name: 'Jarvis', state: 'ready' },
    connection(githubToolPrefix, 'GitHub', bridges),
    connection(azureToolPrefix, 'Azure', bridges),
  ];
}

export function piCapabilityInventory(registry: ToolRegistry, bridges: readonly RemoteMcpBridge[]): string {
  const connections = piConnectionInventory(bridges)
    .map(({ name, state, ...rest }) => `${name}=${state}${'reason' in rest ? ` (${rest.reason})` : ''}`)
    .join('; ');
  return [
    '[PI capability and connection status from Jarvis. "Idle", "starting", "stale", "unreachable" and "not_configured" are not freshly verified. Use find_tools for an exact schema before calling a tool.]',
    `Connections: ${connections}.`,
    capabilityIndex(registry),
  ].join('\n');
}
