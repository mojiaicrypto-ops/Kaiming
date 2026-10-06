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
}

interface Registered {
  readonly handle: PiSessionHandle;
  readonly configHash: string;
}

export class SessionRegistry {
  private readonly factory: PiRuntimeFactory;
  private readonly entries = new Map<string, Registered>();

  constructor(factory: PiRuntimeFactory) {
    this.factory = factory;
  }

  async acquire(spec: LogicalSessionSpec, config: EffectiveConfig): Promise<PiSessionHandle> {
    const configHash = digestJson(config);
    const existing = this.entries.get(spec.sessionId);
    if (existing !== undefined) {
      const boundFile = spec.piFile;
      // The bound history must still be the file this handle really uses, and it must still exist:
      // continuing against a vanished history would silently start a partial replacement history.
      if (existing.configHash === configHash && boundFile !== undefined && existing.handle.piFile() !== boundFile) {
        existing.handle.dispose();
        this.entries.delete(spec.sessionId);
        throw new HistoryUnavailableError(boundFile);
      }
      if (existing.configHash === configHash) {
        if (boundFile !== undefined && !existsSync(boundFile)) {
          existing.handle.dispose();
          this.entries.delete(spec.sessionId);
          throw new HistoryUnavailableError(boundFile);
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
    });
    this.entries.set(spec.sessionId, { handle, configHash });
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