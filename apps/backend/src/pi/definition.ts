/** The PI agent definition the gateway expects. A test keeps these equal to agents/pi/definition.json, which the Deploy job provisions. */
export const PI_MODEL = 'gpt-6.1-terra';
export const PI_REASONING_EFFORT = 'low';
export const PI_MCP_SERVER_LABEL = 'jarvis';
/** Required prompt-agent structured input that Foundry renders into PI's trusted instructions. */
export const PI_CONTEXT_INPUT = 'pi_context';
/** GitHub's remote MCP server with every toolset. The backend, not the harness, connects to it; see github-bridge.ts. */
export const PI_GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/x/all';

/** Exact agent-scoped feature header from azure-ai-projects 2.9.0 (same value as agents/jarvis/managed_copilot.py). */
export const PI_PREVIEW_HEADER = [
  'WorkflowAgents=V1Preview', 'ExternalAgents=V1Preview', 'DraftAgents=V1Preview', 'VoiceAgents=V1Preview',
  'DigitalWorker=V1Preview', 'GitHubCopilot=V1Preview', 'Skills=V1Preview', 'MicrosoftCopilot=V1Preview',
  'ModelRouterControls=V1Preview',
].join(',');
