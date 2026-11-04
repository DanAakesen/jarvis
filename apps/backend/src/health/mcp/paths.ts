export const healthMcpPath = '/health/mcp';
export const healthMcpMetadataPath = '/.well-known/oauth-protected-resource/health/mcp';
/** Temporary alias: connectors registered before the Daily to Health rename keep their configured /daily/mcp resource. Remove with the /daily route alias (docs/decisions.md). */
export const legacyDailyMcpPath = '/daily/mcp';
export const legacyDailyMcpMetadataPath = '/.well-known/oauth-protected-resource/daily/mcp';
export const healthMcpPaths: ReadonlySet<string> = new Set([healthMcpPath, legacyDailyMcpPath]);
export const healthMcpMetadataPaths: ReadonlySet<string> = new Set([healthMcpMetadataPath, legacyDailyMcpMetadataPath]);
