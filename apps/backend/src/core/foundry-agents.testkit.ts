import { createFoundryAgentAdmin } from './foundry-agents.js';

/** Stateful emulator for the Foundry project REST endpoints used by agent administration. */
export function foundryProjectFixture(status: string | null = 'active') {
  const instructions = 'Hello\nKEEP THIS BLOCK: backend tool contract (start)\ncontract\nKEEP THIS BLOCK: backend tool contract (end)';
  const versions = new Map([['1', { definition: { kind: 'prompt', instructions, model: 'model-a', tools: [{ type: 'function', name: 'lookup' }] },
    description: 'Fixture', metadata: { tag: 'fixture' } }]]);
  let pinned: string | undefined;
  const calls: string[] = [];
  const agent = 'fixture-agent';
  const details = () => ({ name: agent, versions: { latest: { version: String(versions.size) } },
    agent_endpoint: { version_selector: { version_selection_rules: pinned ? [{ type: 'FixedRatio', traffic_percentage: 100, agent_version: pinned }] : [] } } });
  const version = (key: string) => ({ name: agent, version: key, object: 'agent.version', ...(status === null ? {} : { status }), ...versions.get(key) });
  const admin = createFoundryAgentAdmin({
    projectEndpoint: 'https://fixture.services.ai.azure.com/api/projects/project',
    getToken: async () => 'offline-token',
    fetch: async (raw, init) => {
      const url = new URL(String(raw));
      const path = url.pathname.slice('/api/projects/project'.length);
      const method = init?.method;
      calls.push(method + ' ' + path);
      if (method === 'GET' && path === '/agents') return Response.json({ data: [details()], has_more: false });
      if (method === 'GET' && path === '/agents/' + agent) return Response.json(details());
      if (method === 'PATCH' && path === '/agents/' + agent) {
        pinned = JSON.parse(String(init?.body)).agent_endpoint.version_selector.version_selection_rules[0].agent_version;
        return Response.json(details());
      }
      const base = '/agents/' + agent + '/versions';
      if (method === 'GET' && path === base) return Response.json({ data: [...versions.keys()].map(version), has_more: false });
      if (method === 'POST' && path === base) {
        const key = String(versions.size + 1);
        versions.set(key, JSON.parse(String(init?.body)));
        return Response.json(version(key));
      }
      const key = path.slice(base.length + 1);
      if (method === 'GET' && path.startsWith(base + '/') && versions.has(key)) return Response.json(version(key));
      return Response.json({}, { status: 404 });
    },
  });
  return { admin, calls, versions, instructions, agent };
}
