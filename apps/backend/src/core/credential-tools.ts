import { ToolRefusal, type JarvisTool } from './tool-registry.js';

const renewCredentialSchema = {
  type: 'object',
  properties: { name: { type: 'string', enum: ['codex-login'] } },
  required: ['name'],
  additionalProperties: false,
} as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const renewCredentialTool: JarvisTool = {
  name: 'renew_credential',
  description: 'Start renewal of the Jarvis Codex login after Dan’s Now confirmation. Only codex-login is supported. Report the outcome and any sign-in step; never request credentials, tokens, or codes.',
  inputSchema: renewCredentialSchema,
  sensitive: true,
  async execute(input, request, signal) {
    if (!isObject(input) || Object.keys(input).length !== 1 || input.name !== 'codex-login') {
      throw new ToolRefusal('Only the codex-login credential can be renewed.');
    }

    const store = request.server.credentialStatusStore;
    const renew = request.server.renewCodexCredential;
    if (!store || !renew) throw new ToolRefusal('Codex login renewal is unavailable.');

    const notifications = request.server.teamsNotifications;
    if (!notifications) throw new ToolRefusal('Now confirmation is unavailable; no renewal was started.');

    return notifications.runConfirmed('other', 'Renew the Jarvis Codex login.', async () => {
      signal.throwIfAborted();

      let outcome: Awaited<ReturnType<typeof renew>>;
      let credential: Awaited<ReturnType<typeof store.list>>[number] | undefined;
      try {
        outcome = await renew();
        credential = (await store.list()).find((row) => row.name === 'codex-login');
      } catch {
        request.log.warn('credentials.codex_renewal_failed');
        throw new ToolRefusal('Codex login renewal or credential status is unavailable; check the status before retrying.');
      }
      if (!credential) throw new ToolRefusal('Codex credential status is unavailable.');

      const guidance = {
        skipped: {
          nextStep: 'Wait for the active Codex task or renewal to finish, then retry.',
          confirmation: 'Codex login renewal is busy; retry when the active work finishes.',
        },
        fresh: {
          nextStep: null,
          confirmation: 'The Jarvis Codex login is already fresh.',
        },
        renewed: {
          nextStep: null,
          confirmation: 'Jarvis Codex login renewed.',
        },
        failed: {
          nextStep: 'Sign in to the Jarvis-only Codex account again, then retry.',
          confirmation: 'Codex login renewal failed. Sign in to the Jarvis-only Codex account again, then retry.',
        },
        uncertain: {
          nextStep: 'Check the credential status before retrying; the renewal outcome is uncertain.',
          confirmation: 'Codex login renewal outcome is uncertain. Check the credential status before retrying.',
        },
      }[outcome];
      return { outcome, credential, ...guidance };
    }, signal);
  },
};
