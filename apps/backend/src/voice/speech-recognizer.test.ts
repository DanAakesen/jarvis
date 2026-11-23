import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import { expect, it } from 'vitest';
import { createAzureSpeechConfig } from './speech-recognizer.js';

it('sends the Speech bearer header on the Node 22 WebSocket upgrade', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const config = createAzureSpeechConfig(new URL('ws://127.0.0.1:' + port + '/stt/speech/universal/v2'), 'test-token');
  const stream = SpeechSDK.AudioInputStream.createPushStream();
  const audio = SpeechSDK.AudioConfig.fromStreamInput(stream);
  const recognizer = new SpeechSDK.SpeechRecognizer(config, audio);
  const connection = SpeechSDK.Connection.fromRecognizer(recognizer);
  try {
    const upgrade = once(server, 'connection');
    await new Promise<void>((resolve, reject) => connection.openConnection(resolve, reject));
    const [, request] = await upgrade;
    expect(request.headers.authorization).toBe('Bearer test-token');
  } finally {
    for (const client of server.clients) client.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
    recognizer.close();
    stream.close();
    config.close();
  }
});
