import { ConfigurationError } from '../configuration-error.js';

export interface AuthConfig {
  tenantId: string;
  apiClientId: string;
  ownerObjectId: string;
}

// Nonsecret IDs from infra/bootstrap.output.json. Deployment can override them.
const bootstrap = {
  tenantId: '802efa29-17f2-4a79-8f5f-38f087aed96a',
  apiClientId: '9f751b64-ea0f-484f-bf09-f08276a69e2f',
  ownerObjectId: '12bcfab7-49ba-4cf7-8be7-780a13911f93',
};

export function loadAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const values: AuthConfig = { ...bootstrap };
  for (const [field, name] of [
    ['tenantId', 'ENTRA_TENANT_ID'],
    ['apiClientId', 'ENTRA_API_CLIENT_ID'],
    ['ownerObjectId', 'ENTRA_OWNER_OBJECT_ID'],
  ] as const) {
    const value = env[name] ?? bootstrap[field];
    if (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)) {
      throw new ConfigurationError(`${name} must be a UUID`);
    }
    values[field] = value.toLowerCase();
  }
  return values;
}
