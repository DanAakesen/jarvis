import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { BackendModule } from '../modules.js';

/** Manual folder order for the Notes page. Display metadata only: it never renames, moves or prefixes a vault file. */
export interface NotesFolderOrder {
  /** The folder whose children are ordered; empty for the vault root. */
  readonly parent: string;
  /** Direct child folder paths, first to last. */
  readonly folders: readonly string[];
}

export interface NotesFolderOrderStore {
  read(ownerObjectId: string, signal: AbortSignal): Promise<NotesFolderOrder[]>;
  replace(ownerObjectId: string, parent: string, folders: readonly string[], signal: AbortSignal): Promise<void>;
}

const maxPathLength = 180;
export const maxOrderedFolders = 500;
const unsafeSegment = /[\\?#%]/u;

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function safeSegment(segment: string): boolean {
  return segment.length > 0 && !segment.startsWith('.') && segment !== '..' && !unsafeSegment.test(segment) &&
    !hasControlCharacters(segment);
}

function safePath(path: string): boolean {
  return path.length <= maxPathLength && path === path.normalize('NFC') && !path.startsWith('/') &&
    path.split('/').every(safeSegment);
}

/** Returns the reason a body is refused, or undefined when it is a safe order for one parent folder. */
export function folderOrderProblem(parent: string, folders: readonly string[]): string | undefined {
  if (parent !== '' && !safePath(parent)) return 'The parent folder is not a safe vault folder.';
  if (folders.length > maxOrderedFolders) return `At most ${maxOrderedFolders} folders can be ordered at once.`;
  const prefix = parent === '' ? '' : `${parent}/`;
  const seen = new Set<string>();
  for (const folder of folders) {
    if (!folder.startsWith(prefix) || !safePath(folder) || folder.slice(prefix.length).includes('/')) {
      return 'Every ordered folder must be a direct child of the parent.';
    }
    if (seen.has(folder)) return 'A folder appears twice.';
    seen.add(folder);
  }
  return undefined;
}

function isOwner(request: FastifyRequest, app: FastifyInstance): boolean {
  return request.principal?.objectId.toLowerCase() === app.ownerObjectId.toLowerCase();
}

const orderSchema = {
  type: 'object',
  properties: {
    parent: { type: 'string', maxLength: maxPathLength },
    folders: {
      type: 'array',
      maxItems: maxOrderedFolders,
      items: { type: 'string', minLength: 1, maxLength: maxPathLength },
    },
  },
  required: ['parent', 'folders'],
  additionalProperties: false,
} as const;

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
  additionalProperties: true,
} as const;

export function createNotesFolderOrderModule(store: NotesFolderOrderStore): BackendModule {
  return {
    id: 'notes-folder-order',
    tools: [],
    registerRoutes: async (app) => {
      app.get('/notes/folder-order', {
        schema: {
          response: {
            200: {
              type: 'object',
              properties: { orders: { type: 'array', items: orderSchema } },
              required: ['orders'],
              additionalProperties: false,
            },
            403: errorSchema,
            503: errorSchema,
          },
        },
      }, async (request, reply) => {
        if (!isOwner(request, app)) return reply.code(403).send({ error: 'Forbidden' });
        const signal = AbortSignal.timeout(30_000);
        try {
          const orders = await store.read(app.ownerObjectId, signal);
          reply.header('Cache-Control', 'private, no-store');
          return { orders };
        } catch {
          request.log.warn('notes_folder_order.read_failed');
          return reply.code(503).send({ error: 'Folder order is unavailable' });
        }
      });

      app.put<{ Body: { parent: string; folders: string[] } }>('/notes/folder-order', {
        schema: {
          body: orderSchema,
          response: { 200: orderSchema, 400: errorSchema, 403: errorSchema, 503: errorSchema },
        },
      }, async (request, reply) => {
        if (!isOwner(request, app)) return reply.code(403).send({ error: 'Forbidden' });
        const { parent, folders } = request.body;
        const problem = folderOrderProblem(parent, folders);
        if (problem) return reply.code(400).send({ error: problem });
        try {
          await store.replace(app.ownerObjectId, parent, folders, AbortSignal.timeout(30_000));
          reply.header('Cache-Control', 'private, no-store');
          return { parent, folders };
        } catch {
          request.log.warn('notes_folder_order.write_failed');
          return reply.code(503).send({ error: 'Folder order could not be saved' });
        }
      });
    },
  };
}
