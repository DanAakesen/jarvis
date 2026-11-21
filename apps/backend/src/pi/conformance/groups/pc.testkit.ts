import { createBrowserAgentModule } from '../../../core/browser-agent.js';
import { createPcBridgeModule } from '../../../pc-bridge/bridge.js';
import { createScreenVisionModule } from '../../../vision/screen.js';
import { createVisionWatchModule } from '../../../vision/watch.js';
import { createVoiceRelayModule } from '../../../voice/relay.js';
import type { GroupFactory } from '../types.testkit.js';
import { unstubbed } from '../stub.testkit.js';

/** Dan's PC (bridge), the browser agent, camera/screen watches, and the voice relay (which has no tools). */
export const pcGroup: GroupFactory = () => ({
  id: 'pc',
  covers: ['pcBridge', 'browserAgent', 'visionWatch', 'screenVision', 'voiceRelay', 'phoneCall'],
  modules: [
    createPcBridgeModule({}),
    createBrowserAgentModule(unstubbed('browserAgent')),
    createScreenVisionModule(unstubbed('screenVision')),
    createVisionWatchModule(unstubbed('visionWatch')),
    createVoiceRelayModule({ getToken: unstubbed('voice.getToken') }),
  ],
});
