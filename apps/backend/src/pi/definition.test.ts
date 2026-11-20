import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { piMcpPath } from '../auth/pi-credential.js';
import { loadConfig } from '../config.js';
import {
  PI_CONTEXT_INPUT, PI_GITHUB_MCP_URL, PI_MCP_SERVER_LABEL, PI_MODEL, PI_POLICY_REVISION,
  PI_PREVIEW_HEADER, PI_REASONING_EFFORT,
} from './definition.js';

const spec = JSON.parse(readFileSync(new URL('../../../../agents/pi/definition.json', import.meta.url), 'utf8')) as {
  github: { url: string }; agentName: string; model: string; reasoningEffort: string; mcp: { serverLabel: string; path: string; requireApproval: string; connection: string };
};
const base = { STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net', FOUNDRY_PROJECT_ENDPOINT: 'https://a.services.ai.azure.com/api/projects/p' };

describe('PI definition', () => {
  it('matches what the Deploy job provisions, so the gateway prices and routes the same agent', () => {
    expect(PI_MODEL).toBe(spec.model);
    expect(PI_REASONING_EFFORT).toBe(spec.reasoningEffort);
    expect(PI_MCP_SERVER_LABEL).toBe(spec.mcp.serverLabel);
    expect(PI_GITHUB_MCP_URL).toBe(spec.github.url);
    expect(piMcpPath).toBe(spec.mcp.path);
    expect(spec.mcp.requireApproval).toBe('never');
    // The MCP secret reaches the harness through a project connection; the tool itself carries no headers.
    expect(spec.mcp.connection).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u);
  });

  it('sends the same preview header as the managed Python adapter', () => {
    const adapter = readFileSync(new URL('../../../../agents/jarvis/managed_copilot.py', import.meta.url), 'utf8');
    for (const feature of PI_PREVIEW_HEADER.split(',')) expect(adapter).toContain(`"${feature}"`);
  });
});

describe('PI instructions', () => {
  const instructions = readFileSync(new URL('../../../../agents/pi/instructions.md', import.meta.url), 'utf8');

  it('binds the owner context through one required provider instruction input', () => {
    expect(PI_CONTEXT_INPUT).toBe('pi_context');
    expect(PI_POLICY_REVISION).toMatch(/^pi-structured-context-v\d+$/u);
    expect(instructions.match(/\{\{pi_context\}\}/gu)).toHaveLength(1);
  });

  it('send the capability overview through discovery, not the smoke-only operation', () => {
    expect(instructions).not.toContain('list_capabilities');
    expect(instructions).toContain('capability overview');
    expect(instructions).toMatch(/capability overview[^\n]*`find_tools`/u);
  });
});

describe('PI configuration', () => {
  it('stays off unless both the agent name and the MCP secret are set', () => {
    expect(loadConfig(base).pi).toBeUndefined();
    expect(loadConfig({ ...base, JARVIS_PI_AGENT_NAME: spec.agentName }).pi).toBeUndefined();
    expect(loadConfig({ ...base, JARVIS_PI_AGENT_NAME: spec.agentName, JARVIS_PI_MCP_SECRET: 'a'.repeat(64) }).pi)
      .toEqual({ agentName: spec.agentName, mcpSecret: 'a'.repeat(64), monthlyCapDkk: 100 });
    const env = { ...base, JARVIS_PI_AGENT_NAME: spec.agentName, JARVIS_PI_MCP_SECRET: 'a'.repeat(64) };
    const azure = { JARVIS_PI_AZURE_MCP_URL: 'https://az.example.io', JARVIS_PI_AZURE_MCP_CLIENT_ID: '3e94b90c-3e35-4187-8f08-9bba23bc8886' };
    expect(loadConfig({ ...env, ...azure }).pi?.azureMcp).toEqual({ url: 'https://az.example.io', clientId: '3e94b90c-3e35-4187-8f08-9bba23bc8886' });
    expect(() => loadConfig({ ...env, JARVIS_PI_AZURE_MCP_URL: azure.JARVIS_PI_AZURE_MCP_URL })).toThrow('JARVIS_PI_AZURE_MCP_URL');
    expect(() => loadConfig({ ...env, ...azure, JARVIS_PI_AZURE_MCP_URL: 'http://az.example.io' })).toThrow('JARVIS_PI_AZURE_MCP_URL');
    const token = `github_pat_${'A'.repeat(60)}`;
    expect(loadConfig({ ...base, JARVIS_PI_AGENT_NAME: spec.agentName, JARVIS_PI_MCP_SECRET: 'a'.repeat(64), JARVIS_PI_GITHUB_TOKEN: token }).pi?.githubToken).toBe(token);
    expect(() => loadConfig({ ...base, JARVIS_PI_AGENT_NAME: spec.agentName, JARVIS_PI_MCP_SECRET: 'a'.repeat(64), JARVIS_PI_GITHUB_TOKEN: `ghp_${'A'.repeat(36)}` })).toThrow('JARVIS_PI_GITHUB_TOKEN');
  });

  it('takes the monthly cap from the environment and refuses unsafe values', () => {
    const env = { ...base, JARVIS_PI_AGENT_NAME: spec.agentName, JARVIS_PI_MCP_SECRET: 'a'.repeat(64) };
    expect(loadConfig({ ...env, JARVIS_PI_MONTHLY_CAP_DKK: '40' }).pi?.monthlyCapDkk).toBe(40);
    for (const bad of ['0', '-1', 'abc', '1000000']) expect(() => loadConfig({ ...env, JARVIS_PI_MONTHLY_CAP_DKK: bad })).toThrow('JARVIS_PI_MONTHLY_CAP_DKK');
    expect(() => loadConfig({ ...env, JARVIS_PI_MCP_SECRET: 'short' })).toThrow('JARVIS_PI_MCP_SECRET');
    expect(() => loadConfig({ ...env, JARVIS_PI_AGENT_NAME: 'jarvis' })).toThrow('JARVIS_PI_AGENT_NAME');
  });
});
