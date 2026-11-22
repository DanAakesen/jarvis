import { capabilityIndex } from '../core/capability-index.js';
import type { ToolRegistry } from '../core/tool-registry.js';
import type { RemoteMcpBridge } from './remote-mcp.js';
import { azureToolPrefix, githubToolPrefix } from './remote-mcp.js';

const MAX_NOTE_CHARACTERS = 1_500;

export interface PiCapabilityNote {
  /** The connection states the note describes. A new note is worth sending only when this changes. */
  readonly signature: string;
  readonly text: string;
}

function connection(prefix: string, label: string, bridges: readonly RemoteMcpBridge[]): string {
  const bridge = bridges.find((candidate) => candidate.prefix === prefix);
  if (!bridge) return `${label}=not_configured`;
  const status = bridge.status();
  return status.state === 'unreachable' || status.state === 'stale'
    ? `${bridge.label}=${status.state} (${status.reason})`
    : `${bridge.label}=${status.state}`;
}

/**
 * The tool overview Jarvis tells PI about once per conversation (and again when a connection changes): which of GitHub and Azure
 * are usable, and the names of the local tools by area. The whole note stays within 1,500 characters.
 */
export function piCapabilityNote(registry: ToolRegistry, bridges: readonly RemoteMcpBridge[]): PiCapabilityNote {
  const states = [
    connection(githubToolPrefix, 'GitHub', bridges),
    connection(azureToolPrefix, 'Azure', bridges),
  ];
  // "Starting" is a load in progress, so it counts as not loaded yet; the reason text is not a state.
  const signature = states
    .map((state) => state.replace(/ \(.*\)$/u, '').replace('=starting', '=idle'))
    .join(';');
  const head = [
    '[Tools: use the directly exposed MCP tools when they fit; use find_tools then call_tool for the rest. GitHub (gh_) and Azure (az_) tools load only when named in a search; "idle", "starting", "stale" and "unreachable" are not freshly verified.]',
    `Connections: Jarvis=ready; ${states.join('; ')}.`,
  ].join('\n');
  const index = capabilityIndex(registry, MAX_NOTE_CHARACTERS - head.length - 1);
  return { signature, text: `${head}\n${index}`.slice(0, MAX_NOTE_CHARACTERS) };
}
