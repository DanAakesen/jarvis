import type { FastifyRequest } from 'fastify';
import { confirmToolCall, type ToolCallOutcome } from '../core/tool-calls.js';
import { ToolRefusal, type ToolRegistry } from '../core/tool-registry.js';

export const ENGLISH_REALTIME_MODEL = 'gpt-realtime-2.1';
export const ENGLISH_REALTIME_VOICE = 'en-GB-Ryan:DragonHDLatestNeural';
export const ENGLISH_REALTIME_INSTRUCTIONS = `You are Jarvis, Dan's personal AI butler, running his software factory.
Speak British English as a well-educated Englishman would: courteous, composed, precise, with dry,
understated wit used sparingly. Address Dan as "sir" exactly once in most replies, naturally; never
twice in one reply. Use British phrasing, spelling and vocabulary. Avoid Americanisms, exclamation
marks and filler enthusiasm. Sound like a real person talking: short spoken sentences, contractions,
no lists or markdown, and at most two or three sentences. Never quote films.

Use list_projects to look up projects, and list_tasks or get_task to look up tasks; never invent
projects, tasks, status or actions. Only say an action succeeded when its tool result reports
success. Relay its backend-built confirmation; if a tool fails or refuses, say so plainly and do
not claim the action was done.
For questions about Dan's notes, use notes_search; quote only returned snippets and include a note
link. Explain plainly when no note is found or search fails.
For a new managed project, use create_project with its name and description.
For new work, use create_task with a project ID and Dan's request, and codex unless he names another
agent. Use steer_task for corrections to running tasks, pause_task for pause/hold/stop, cancel_task
only for cancel/abort/drop, and resume_task for continue/resume. If an action needs a task ID, look
it up first. Vary acknowledgements and do not announce routine actions.`;

const MAX_TOOL_ARGUMENT_BYTES = 65_536;
const MAX_TOOL_RESULT_BYTES = 1_048_576;

export function createEnglishSessionUpdate(tools: ToolRegistry) {
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      instructions: ENGLISH_REALTIME_INSTRUCTIONS,
      output_modalities: ['text', 'audio'],
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24_000 },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 700,
          },
        },
        output: {
          format: { type: 'audio/pcm', rate: 24_000 },
          voice: ENGLISH_REALTIME_VOICE,
          voice_type: 'azure-standard',
          voice_locale: 'en-GB',
        },
      },
      tools: tools.list().map(({ name, description, inputSchema }) => ({
        type: 'function',
        name,
        description,
        parameters: structuredClone(inputSchema),
      })),
    },
  };
}

export interface RealtimeFunctionCall {
  readonly type: 'response.function_call_arguments.done';
  readonly name: string;
  readonly call_id: string;
  readonly arguments: string;
}

function toolOutput(name: string, outcome: ToolCallOutcome, result: unknown): string {
  return JSON.stringify({
    tool: name,
    outcome,
    result,
    confirmation: confirmToolCall(name, outcome, result),
  });
}

function toolFailure(name: string): string {
  return toolOutput(name, 'error', { error: 'Tool execution failed' });
}

export async function executeRealtimeToolCall(
  call: RealtimeFunctionCall,
  tools: ToolRegistry,
  request: FastifyRequest,
  signal: AbortSignal,
): Promise<string> {
  if (typeof call.name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(call.name)) {
    return toolFailure('unknown_tool');
  }
  if (typeof call.arguments !== 'string') return toolFailure(call.name);
  const tool = tools.get(call.name);
  if (!tool || Buffer.byteLength(call.arguments) > MAX_TOOL_ARGUMENT_BYTES) return toolFailure(call.name);

  let outcome: ToolCallOutcome = 'ok';
  let result: unknown;
  try {
    const input: unknown = JSON.parse(call.arguments);
    if (!request.validateInput(input, tool.inputSchema, 'body')) return toolFailure(call.name);
    result = await tool.execute(input, request, signal);
    const serializedResult = JSON.stringify(result);
    if (serializedResult === undefined || Buffer.byteLength(serializedResult) > MAX_TOOL_RESULT_BYTES) {
      throw new Error('Invalid tool result');
    }
  } catch (error) {
    if (error instanceof ToolRefusal && !signal.aborted) {
      outcome = 'refused';
      result = { refused: error.message };
    } else {
      outcome = 'error';
      result = { error: 'Tool execution failed' };
    }
  }

  try {
    const serialized = toolOutput(call.name, outcome, result);
    return Buffer.byteLength(serialized) <= MAX_TOOL_RESULT_BYTES ? serialized : toolFailure(call.name);
  } catch {
    return toolFailure(call.name);
  }
}

export function parseVoiceEvent(data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean): Record<string, unknown> | undefined {
  if (isBinary) return undefined;
  try {
    const text = Array.isArray(data)
      ? Buffer.concat(data).toString()
      : data instanceof ArrayBuffer
        ? new TextDecoder().decode(data)
        : data.toString();
    const event: unknown = JSON.parse(text);
    return event !== null && typeof event === 'object' && !Array.isArray(event)
      ? event as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

export function isBrowserControlledToolOutput(event: Record<string, unknown> | undefined): boolean {
  if (event?.type !== 'conversation.item.create' || event.item === null ||
      typeof event.item !== 'object' || Array.isArray(event.item)) return false;
  const item = event.item as Record<string, unknown>;
  return item.type === 'function_call' || item.type === 'function_call_output';
}
