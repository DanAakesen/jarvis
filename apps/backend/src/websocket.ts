import websocket from '@fastify/websocket';
import type {
  FastifyBaseLogger, FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault,
} from 'fastify';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

export const VOICE_SUBPROTOCOL = 'jarvis.voice.v1';
export const PC_BRIDGE_SUBPROTOCOL = 'jarvis.pc.v1';

export const MAX_WEBSOCKET_PAYLOAD_BYTES = 1_050_000;
export function registerWebSocketPlugin<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>,
): () => void {
  const pendingUpgrades = new Set<Duplex>();
  const trackUpgrade = (_request: IncomingMessage, socket: Duplex) => {
    pendingUpgrades.add(socket);
    socket.once('close', () => { pendingUpgrades.delete(socket); });
    socket.once('end', () => {
      if (pendingUpgrades.has(socket)) socket.destroy();
    });
  };
  app.server.on('upgrade', trackUpgrade);
  app.addHook('onReady', async () => {
    app.websocketServer.on('connection', (_socket, request) => {
      pendingUpgrades.delete(request.socket);
    });
  });
  app.addHook('onClose', async () => { app.server.removeListener('upgrade', trackUpgrade); });
  app.register(websocket, {
    // Route modules close their own sockets before the shared WebSocket server drains.
    preClose: async () => undefined,
    options: {
      maxPayload: MAX_WEBSOCKET_PAYLOAD_BYTES,
      perMessageDeflate: false,
      handleProtocols: (protocols, request) => {
        const path = request.url?.split('?')[0];
        const expected = path === '/pc-bridge/connect'
          ? PC_BRIDGE_SUBPROTOCOL
          : path === '/voice' || path === '/voice/da' ? VOICE_SUBPROTOCOL : undefined;
        return expected && protocols.has(expected) ? expected : false;
      },
    },
  });

  return () => {
    // Register after route modules so their pre-close hooks run first.
    app.register(async (instance) => {
      instance.addHook('preClose', async () => {
        for (const socket of pendingUpgrades) socket.destroy();
        for (const socket of app.websocketServer.clients) {
          socket.close(1012, 'Service restarting; reconnect');
        }
        await new Promise<void>((resolve, reject) => {
          app.websocketServer.close((error) => error ? reject(error) : resolve());
        }).catch((error: unknown) => { app.shutdownErrors.push(error); });
      });
    });
  };
}
