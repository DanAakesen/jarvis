import { describe, expect, it } from 'vitest';
import { createAzureSpeechEndpoint } from './speech-recognizer.js';

describe('Azure Speech endpoint', () => {
  it('uses the custom subdomain universal Speech endpoint of the Foundry resource', () => {
    expect(createAzureSpeechEndpoint(
      'https://jarvis-resource.cognitiveservices.azure.com/api/projects/jarvis',
    ).href).toBe('wss://jarvis-resource.cognitiveservices.azure.com/speech/universal/v2');
  });

  it.each([
    'http://jarvis-resource.cognitiveservices.azure.com/api/projects/jarvis',
    'https://example.com/api/projects/jarvis',
    'https://jarvis-resource.cognitiveservices.azure.com/api/projects/../secret',
    'https://credentials@jarvis-resource.cognitiveservices.azure.com/api/projects/jarvis',
    'https://jarvis-resource.cognitiveservices.azure.com/api/projects/jarvis?key=secret',
  ])('rejects an unsafe runtime endpoint', (endpoint) => {
    expect(() => createAzureSpeechEndpoint(endpoint)).toThrow(
      'Foundry runtime endpoint must be a secure Azure AI resource URL',
    );
  });
});
