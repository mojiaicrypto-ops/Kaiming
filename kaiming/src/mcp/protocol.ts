/**
 * The MCP surface itself: JSON-RPC 2.0 over stdio or over the workbench's HTTP endpoint, one tool
 * catalogue, no business logic (that lives in `runs.ts`).
 *
 * Version policy: 2025-11-25 and 2025-06-18 are both served, because the clients that call it today
 * negotiate those (measured: Codex 0.155.1 asks 2025-06-18, Claude Code asks 2025-11-25 after probing
 * `server/discover`). The 2026-07-28 stateless generation is deliberately not claimed: its shapes are
 * still in draft in the specification and in the official SDK. `server/discover` is answered as a
 * compatibility probe so a newer client negotiates down instead of failing.
 */
import { ControlError } from './control.ts';
import type { RunPayload, RunTools } from './runs.ts';

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18'] as const;

export interface JsonRpcRequest {
  readonly jsonrpc?: string;
  readonly id?: string | number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

export interface ServerInfo {
  readonly name: string;
  readonly title: string;
  readonly version: string;
}

export interface McpProtocolOptions {
  readonly tools: RunTools;
  readonly info: ServerInfo;
  /** Progress notifications for a request, when the client supplied a progress token. */
  readonly notifyProgress?: (progressToken: unknown, progress: number, total: number | undefined, message: string) => void;
  /** Diagnostics: stderr only, never stdout (stdio discipline). */
  readonly log?: (line: string) => void;
}

interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown>;
  readonly annotations: Record<string, boolean>;
  readonly run: (args: Record<string, unknown>, progress: (message: string) => void) => Promise<unknown>;
}

/** The shape every run-carrying tool returns; `undefined` fields are dropped by the serialiser. */
const runOutputSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    runId: { type: 'string' },
    taskId: { type: ['string', 'null'] },
    status: {
      type: 'string',
      enum: ['running', 'queued', 'waiting_user', 'paused', 'unknown', 'completed', 'failed', 'cancelled'],
    },
    phase: { type: ['string', 'null'] },
    taskType: { type: ['string', 'null'] },
    summary: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          phase: { type: 'string' },
          round: { type: 'integer' },
          state: { type: 'string', enum: ['completed', 'in_progress', 'planned'] },
          members: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                roleId: { type: 'string' },
                label: { type: 'string' },
                activity: { type: 'string' },
                lastInputStatus: { type: ['string', 'null'] },
                passed: { type: 'boolean' },
              },
              required: ['roleId', 'label', 'activity', 'passed'],
            },
          },
        },
        required: ['phase', 'round', 'state', 'members'],
      },
    },
    stepsDone: { type: 'integer' },
    stepsTotal: { type: 'integer' },
    pendingQuestion: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            id: { type: 'string' },
            method: { type: 'string' },
            title: { type: 'string' },
            message: { type: ['string', 'null'] },
            options: { type: ['array', 'null'], items: { type: 'string' } },
            placeholder: { type: ['string', 'null'] },
          },
          required: ['id', 'method', 'title'],
        },
      ],
    },
    awaiting: { type: 'string', enum: ['queued', 'blocked', 'user', 'none'] },
    waitingForTask: { type: ['string', 'null'] },
    queuedInputs: { type: 'integer' },
    complete: { type: 'boolean' },
  },
  required: ['runId', 'status', 'summary', 'steps', 'stepsDone', 'stepsTotal', 'complete'],
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/**
 * One catalogue for both transports. Descriptions are English because they reach a model as system
 * text (G4), and they say what the caller must do next, not how it is implemented.
 */
export function toolDefinitions(tools: RunTools): readonly ToolDefinition[] {
  const projectHelp = tools.projectPathRequired
    ? 'Absolute project directory (required on this endpoint).'
    : 'Absolute project directory. Omit to use the project this connection serves.';
  const runArgs = {
    type: 'object',
    properties: {
      run_id: { type: 'string', description: 'The runId returned by kaiming_delegate or kaiming_runs.' },
    },
    required: ['run_id'],
    additionalProperties: false,
  } as const;

  return [
    {
      name: 'kaiming_delegate',
      title: 'Delegate work to Kaiming',
      description:
        'Hand one piece of work to Kaiming, which organises design, implementation, independent review, testing and settlement as the work requires. Returns a runId plus the current state; call kaiming_wait or kaiming_status for progress and kaiming_read for the report. The work continues after this call returns.',
      inputSchema: {
        type: 'object',
        properties: {
          objective: { type: 'string', description: 'What must be achieved, in one or two sentences.' },
          mode: {
            type: 'string',
            enum: ['review', 'implement', 'test'],
            description: 'What kind of work you expect. A hint: Kaiming decides the Task type itself.',
          },
          acceptance: { type: 'string', description: 'What would make this work acceptable, if you know.' },
          scope: { type: 'string', description: 'Paths, modules or boundaries the work must stay inside.' },
          requires_test: { type: 'boolean', description: 'Whether you expect executed tests on the result.' },
          project_path: { type: 'string', description: projectHelp },
          wait_seconds: {
            type: 'integer',
            minimum: 0,
            maximum: 45,
            description: 'Wait this long for the first change before returning (default 20).',
          },
        },
        required: ['objective'],
        additionalProperties: false,
      },
      outputSchema: runOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      run: (args) => tools.delegate(args),
    },
    {
      name: 'kaiming_status',
      title: 'Read the state of a run',
      description:
        'Current state of one delegation: status, the phases that ran (rework appears as a new round), the phases still planned, members, and any question waiting for an answer. Reports and the Plan, not this call, are the authority on what was delivered.',
      inputSchema: runArgs,
      outputSchema: runOutputSchema,
      annotations: READ_ONLY,
      run: (args) => tools.status(args),
    },
    {
      name: 'kaiming_wait',
      title: 'Wait for the next change',
      description:
        'Hold for up to 45 seconds and return as soon as the run changes (status, phase, member, question). Use it in a loop instead of one long call; a returned run is not necessarily finished.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: { type: 'string', description: 'The runId to watch.' },
          seconds: { type: 'integer', minimum: 0, maximum: 45, description: 'Upper bound for this wait (default 25).' },
        },
        required: ['run_id'],
        additionalProperties: false,
      },
      outputSchema: runOutputSchema,
      annotations: READ_ONLY,
      run: (args, progress) => tools.wait(args, progress),
    },
    {
      name: 'kaiming_tell',
      title: 'Send a follow-up instruction',
      description:
        'Add an instruction to the Task this run is coordinating, for example an answer to something the agent already asked as a report or a narrower scope. Rejected when the run has no Task yet.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: { type: 'string', description: 'The runId the instruction belongs to.' },
          message: { type: 'string', description: 'The instruction, addressed to the agent.' },
        },
        required: ['run_id', 'message'],
        additionalProperties: false,
      },
      outputSchema: runOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      run: (args) => tools.tell(args),
    },
    {
      name: 'kaiming_answer',
      title: 'Answer a question a run is waiting on',
      description:
        'Answer the pending question reported by kaiming_status. For a confirm question pass a boolean; for a select or input question pass the chosen text. Nothing is answered automatically: the run waits until this call is made.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: { type: 'string', description: 'The runId that is waiting.' },
          question_id: { type: 'string', description: 'pendingQuestion.id from kaiming_status.' },
          answer: {
            type: ['string', 'boolean'],
            description: 'The chosen option text, the typed value, or true/false for a confirm question.',
          },
        },
        required: ['run_id', 'question_id', 'answer'],
        additionalProperties: false,
      },
      outputSchema: runOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      run: (args) => tools.answer(args),
    },
    {
      name: 'kaiming_cancel',
      title: 'Cancel a run',
      description:
        'Stop this delegation and the Task it coordinates. Work already done is kept; nothing is rolled back, and "requested" is reported separately from "actually stopped".',
      inputSchema: runArgs,
      outputSchema: runOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      run: (args) => tools.cancel(args),
    },
    {
      name: 'kaiming_read',
      title: 'Read a run’s result',
      description:
        'Read what a run produced: the latest report, the saved Plan, the conversation tail, or the project file list. The report and the Plan are the authority on what was delivered and checked.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: { type: 'string', description: 'The runId to read from.' },
          kind: { type: 'string', enum: ['report', 'plan', 'transcript', 'files'] },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'For transcript: how many entries (default 20).' },
          path: { type: 'string', description: 'For files: a project-relative directory to list.' },
        },
        required: ['run_id', 'kind'],
        additionalProperties: false,
      },
      outputSchema: { type: 'object', additionalProperties: true },
      annotations: READ_ONLY,
      run: (args) => tools.read(args),
    },
    {
      name: 'kaiming_runs',
      title: 'List recent work in this project',
      description:
        'Recent Tasks of the project with their runId. Use it to reattach to a Task you lost (for example when a delegate call failed before returning its runId) instead of delegating the same work twice. A delegation the agent answered directly creates no Task and is not listed.',
      inputSchema: {
        type: 'object',
        properties: {
          project_path: { type: 'string', description: projectHelp },
          limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many tasks (default 10).' },
        },
        additionalProperties: false,
      },
      outputSchema: { type: 'object', additionalProperties: true },
      annotations: READ_ONLY,
      run: (args) => tools.runs(args),
    },
    {
      name: 'kaiming_projects',
      title: 'List projects',
      description:
        'Projects this workbench has opened: id, directory, whether the directory still exists, session and task counts, last activity. Read-only; it reads no project files and calls no model.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Page size (default 50).' },
          cursor: { type: 'string', description: 'nextCursor from a previous page.' },
        },
        additionalProperties: false,
      },
      outputSchema: { type: 'object', additionalProperties: true },
      annotations: READ_ONLY,
      run: (args) => tools.projects(args),
    },
    {
      name: 'kaiming_requirements',
      title: 'List or read requirements',
      description:
        'Requirements of one project: proposals and implementation requirements with status and readability, or one requirement’s full content by id. Unreadable files are reported, not hidden. Read-only.',
      inputSchema: {
        type: 'object',
        properties: {
          project_path: { type: 'string', description: projectHelp },
          kind: { type: 'string', enum: ['proposal', 'implementation'], description: 'Filter by requirement kind.' },
          status: { type: 'string', description: 'Filter by status, e.g. pending, in_progress, completed, archived.' },
          requirement_id: { type: 'string', description: 'Return this requirement’s full content instead of a list.' },
          limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Page size (default 50).' },
          cursor: { type: 'string', description: 'nextCursor from a previous page.' },
        },
        additionalProperties: false,
      },
      outputSchema: { type: 'object', additionalProperties: true },
      annotations: READ_ONLY,
      run: (args) => tools.requirements(args),
    },
  ];
}

export interface McpProtocol {
  /** Handle one JSON-RPC message; `null` means "no response" (a notification). */
  handle(message: JsonRpcRequest): Promise<JsonRpcResponse | null>;
  readonly info: ServerInfo;
}

function supportedVersion(requested: unknown): string | null {
  if (typeof requested !== 'string') return null;
  if ((PROTOCOL_VERSIONS as readonly string[]).includes(requested)) return requested;
  // A newer client gets the newest we serve; the spec's rule is "highest version ≤ requested".
  return PROTOCOL_VERSIONS[0];
}

export function createMcpProtocol(options: McpProtocolOptions): McpProtocol {
  const tools = toolDefinitions(options.tools);
  const log = options.log ?? (() => undefined);

  const ok = (id: string | number | null, result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });
  const fail = (id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse => ({
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  });

  const callTool = async (
    name: string,
    args: Record<string, unknown>,
    progressToken: unknown,
  ): Promise<unknown> => {
    const tool = tools.find((entry) => entry.name === name);
    if (tool === undefined) throw new ControlError('INVALID_ARGUMENT', `unknown tool ${name}`);
    let counter = 0;
    const tagged = typeof progressToken === 'string' || typeof progressToken === 'number';
    const notify = (message: string): void => {
      counter += 1;
      // The spec requires the token in the notification; without one there is nothing to attach to.
      if (tagged) options.notifyProgress?.(progressToken, counter, undefined, message);
      log(`progress ${String(counter)}: ${message}`);
    };
    return tool.run(args, notify);
  };

  const toolResult = (payload: unknown): { content: unknown[]; structuredContent: unknown; isError: boolean } => ({
    // The spec asks for the serialised JSON as text as well: older clients read only this.
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: false,
  });

  const toolError = (error: ControlError): { content: unknown[]; isError: true } => ({
    content: [{ type: 'text', text: `${error.code}: ${error.message}` }],
    isError: true,
  });

  return {
    info: options.info,
    async handle(message) {
      const id = message.id ?? null;
      const method = message.method;
      if (typeof method !== 'string') {
        return message.id === undefined ? null : fail(id, -32600, 'method is required');
      }
      if (message.id === undefined) {
        // Notifications never get a response. Cancellation is cooperative and the work keeps
        // running, which is what the product promises; nothing else is expected here.
        return null;
      }
      const params = message.params ?? {};
      switch (method) {
        case 'initialize': {
          const version = supportedVersion(params['protocolVersion']);
          if (version === null) {
            return fail(id, -32602, 'protocolVersion must be a string');
          }
          log(`initialize ${String(params['protocolVersion'])} -> ${version}`);
          return ok(id, {
            protocolVersion: version,
            capabilities: { tools: { listChanged: false } },
            serverInfo: options.info,
            instructions:
              'Kaiming organises delivery work: delegate an objective, watch the phases, answer questions, read the report. Prefer kaiming_wait over long blocking calls.',
          });
        }
        case 'server/discover':
          // Backward-compatibility probe of the 2026 stateless generation: answering it lets a
          // modern client negotiate one of the versions we actually serve.
          return ok(id, {
            protocolVersions: [...PROTOCOL_VERSIONS],
            capabilities: { tools: {} },
            serverInfo: options.info,
          });
        case 'ping':
          return ok(id, {});
        case 'tools/list':
          return ok(id, {
            tools: tools.map((tool) => ({
              name: tool.name,
              title: tool.title,
              description: tool.description,
              inputSchema: tool.inputSchema,
              outputSchema: tool.outputSchema,
              annotations: tool.annotations,
            })),
          });
        case 'tools/call': {
          const name = params['name'];
          if (typeof name !== 'string') return fail(id, -32602, 'name is required');
          const args = params['arguments'];
          if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
            return fail(id, -32602, 'arguments must be an object');
          }
          const meta = params['_meta'];
          const progressToken = typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>)['progressToken'] : undefined;
          try {
            const payload = (await callTool(name, (args as Record<string, unknown> | undefined) ?? {}, progressToken)) as
              | RunPayload
              | Record<string, unknown>;
            return ok(id, toolResult(payload));
          } catch (error) {
            const control = error instanceof ControlError
              ? error
              : new ControlError('STORAGE_UNAVAILABLE', error instanceof Error ? error.message : String(error));
            log(`tool ${name} failed: ${control.code}: ${control.message}`);
            // A tool that failed in business terms is a result with isError, not a protocol error:
            // the calling model can read the reason and continue.
            return ok(id, toolError(control));
          }
        }
        default:
          return fail(id, -32601, `Method not found: ${method}`);
      }
    },
  };
}
