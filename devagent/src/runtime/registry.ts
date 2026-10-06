/**
 * Session registry (P2): one Pi instance per logical session, reused across inputs.
 *
 * A session whose effective configuration changed is rebuilt (and the old instance disposed) rather
 * than silently running the rest of its work under a different model.
 */
import { existsSync } from 'node:fs';
import { digestJson } from './hash.ts';
import { HistoryUnavailableError } from './pi-runtime.ts';
import type { CreateSessionOptions, PiRuntimeFactory, PiSessionHandle } from './pi-runtime.ts';
import type { EffectiveConfig } from './config.ts';

export interface LogicalSessionSpec {
  readonly sessionId: string;
  readonly cwd: string;
  readonly piFile?: string;
  readonly customTools?: CreateSessionOptions['customTools'];
  readonly extensionFactories?: CreateSessionOptions['extensionFactories'];
  readonly appendSystemPrompt?: CreateSessionOptions['appendSystemPrompt'];
  readonly tools?: CreateSessionOptions['tools'];
}

interface Registered {
  readonly handle: PiSessionHandle;
  /** Everything that must stay identical for the handle to be reusable. */
  readonly bindingHash: string;
}

export class SessionRegistry {
  private readonly factory: PiRuntimeFactory;
  private readonly entries = new Map<string, Registered>();

  constructor(factory: PiRuntimeFactory) {
    this.factory = factory;
  }

  async acquire(spec: LogicalSessionSpec, config: EffectiveConfig): Promise<PiSessionHandle> {
    // Reuse only when everything that shapes the session is identical: config, tool allowlist and the
    // appended prompt. The history file is compared against the handle's own file instead of being
    // hashed, so "no file requested" and "the file this handle already uses" stay the same session.
    const bindingHash = digestJson({
      config,
      tools: spec.tools ?? null,
      appendSystemPrompt: spec.appendSystemPrompt ?? null,
    });
    const existing = this.entries.get(spec.sessionId);
    if (existing !== undefined) {
      const requestedFile = spec.piFile;
      const handleFile = existing.handle.piFile();
      const sameFile = requestedFile === undefined || requestedFile === handleFile;
      if (existing.bindingHash === bindingHash && sameFile) {
        if (requestedFile !== undefined && !existsSync(requestedFile)) {
          // The bound history vanished: continuing would start a partial replacement history.
          existing.handle.dispose();
          this.entries.delete(spec.sessionId);
          throw new HistoryUnavailableError(requestedFile);
        }
        return existing.handle;
      }
      existing.handle.dispose();
      this.entries.delete(spec.sessionId);
    }
    const handle = await this.factory.create(config, {
      cwd: spec.cwd,
      ...(spec.piFile !== undefined ? { piFile: spec.piFile } : {}),
      ...(spec.customTools !== undefined ? { customTools: spec.customTools } : {}),
      ...(spec.extensionFactories !== undefined
        ? { extensionFactories: spec.extensionFactories }
        : {}),
      ...(spec.appendSystemPrompt !== undefined
        ? { appendSystemPrompt: spec.appendSystemPrompt }
        : {}),
      ...(spec.tools !== undefined ? { tools: spec.tools } : {}),
    });
    this.entries.set(spec.sessionId, { handle, bindingHash });
    return handle;
  }

  get(sessionId: string): PiSessionHandle | undefined {
    return this.entries.get(sessionId)?.handle;
  }

  /** Number of live Pi instances; used by tests to prove no instance leaks. */
  count(): number {
    return this.entries.size;
  }

  dispose(sessionId: string): void {
    const existing = this.entries.get(sessionId);
    if (existing !== undefined) {
      existing.handle.dispose();
      this.entries.delete(sessionId);
    }
  }

  disposeAll(): void {
    for (const sessionId of [...this.entries.keys()]) {
      this.dispose(sessionId);
    }
  }
}