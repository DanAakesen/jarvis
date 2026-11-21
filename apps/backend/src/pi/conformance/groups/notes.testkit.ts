import { createMemoryModule } from '../../../core/memory.js';
import { createInboxModule } from '../../../inbox/module.js';
import { createProactiveToolsModule } from '../../../proactive/tools.js';
import { createVaultModule } from '../../../vault/index.js';
import type { GroupFactory } from '../types.testkit.js';
import { unstubbed } from '../stub.testkit.js';

/** Memory, notes (vault), vault tasks, the inbox, owner reminders and proactive findings: golden scenarios 2 and 3. */
export const notesGroup: GroupFactory = (context) => ({
  id: 'notes',
  covers: ['memory', 'vault', 'inbox', 'proactive'],
  modules: [
    createMemoryModule({ store: unstubbed('memoryStore') }),
    createVaultModule({
      client: unstubbed('vaultClient'), indexStore: unstubbed('vaultIndexStore'),
      memoryStore: unstubbed('memoryStore'), apiMemoryStore: unstubbed('memoryStore'),
    }),
    createInboxModule({ store: unstubbed('inboxStore'), memoryStore: unstubbed('memoryStore'), index: unstubbed('inboxIndex') }),
    createProactiveToolsModule({
      enabled: true, ownerObjectId: context.owner, store: unstubbed('proactiveStore'),
      ownerReminders: unstubbed('ownerReminderStore'), vault: unstubbed('vaultClient'),
    })!,
  ],
});
