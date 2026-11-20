import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';

export const SPEECH_AUTH_SCOPE = 'https://cognitiveservices.azure.com/.default';

export function createAzureSpeechEndpoint(runtimeEndpoint: string): URL {
  let resource: URL;
  try {
    resource = new URL(runtimeEndpoint);
  } catch {
    throw new TypeError('Foundry runtime endpoint must be a valid URL');
  }
  if (resource.protocol !== 'https:' || resource.port ||
      !resource.hostname.endsWith('.cognitiveservices.azure.com') ||
      !/^\/api\/projects\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(resource.pathname) ||
      resource.username || resource.password || resource.search || resource.hash) {
    throw new TypeError('Foundry runtime endpoint must be a secure Azure AI resource URL');
  }
  // Custom-domain Speech endpoints need the /stt prefix; /speech/universal/v2 returned 404 (L111).
  return new URL(`wss://${resource.hostname}/stt/speech/universal/v2`);
}

export function createAzureSpeechConfig(
  endpoint: URL,
  token: string,
): SpeechSDK.SpeechConfig {
  const speechConfig = SpeechSDK.SpeechConfig.fromEndpoint(endpoint);
  speechConfig.authorizationToken = token;
  return speechConfig;
}
