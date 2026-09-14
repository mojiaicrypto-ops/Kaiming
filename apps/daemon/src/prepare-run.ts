/**
 * Building a Runner invocation from a Run's frozen state (WP-11 A2-T6).
 *
 * `execution.md` §2: a Run's provider, model and role come from its *frozen* configuration
 * snapshot; the prompt comes from the frozen dispatch. This module turns those facts into
 * the arguments the Runner process needs, and writes the per-Attempt model catalog that
 * points the Pi session at the Core's gateway.
 *
 * Known limits of this slice, stated rather than hidden:
 *
 * - the working directory is the project root; per-Task worktrees arrive with the
 *   tool-execution slice, and the write barrier already prevents a live Attempt from
 *   being replaced;
 * - the prompt is the Work goal plus the role/stage contract. Full ContextBuilder assembly
 *   (selected sources, read ledger, budgets) is the next slice;
 * - the Pi session is started tool-free (`apps/runner`'s `BUILTIN_TOOLS` is still empty),
 *   so this slice proves the execution and model path, not tool bridging.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { ProjectStore } from '@agentdev/storage';
import type { AttemptCapabilityStore, ConfigStore } from '@agentdev/core';
import type { PrepareRun, PrepareRunInput, RunnerInvocation } from '@agentdev/core';

import { writeAttemptCatalog } from './runner-spawn.js';

export interface PrepareRunOptions {
  readonly store: ProjectStore;
  readonly config: ConfigStore;
  readonly capabilities: AttemptCapabilityStore;
  /** Base URL of the Core's model gateway (`createModelGatewayProxy`). */
  readonly gatewayUrl: string;
  /** Project root used as the working directory for this slice. */
  readonly projectRoot: string;
  /** Directory holding per-Attempt state (catalog, agent dir). */
  readonly attemptsDir: string;
  readonly log?: (line: string) => void;
}

/** Builds the prompt for one Attempt from the Work the Run belongs to. */
function promptFor(input: PrepareRunInput, store: ProjectStore): string {
  const work = store.works.find(input.run.workId);
  const goal = work?.goal ?? 'the assigned task';
  return [
    `You are the AgentDev ${input.run.role} agent.`,
    `Stage: ${input.run.stage}. Purpose: ${input.run.purpose}.`,
    `Goal: ${goal}`,
    'Answer with the result of this stage and nothing else. Tool use is not available in this run.',
  ].join('\n');
}

export function createPrepareRun(options: PrepareRunOptions): PrepareRun {
  const log = options.log ?? (() => undefined);
  return (input: PrepareRunInput): RunnerInvocation => {
    const frozen = options.config.readFrozen(input.run.configSnapshotId);
    if (frozen === undefined) {
      throw new Error(
        `config snapshot ${input.run.configSnapshotId} is missing for Run ${input.run.id}`,
      );
    }
    const capability = options.capabilities.issue({
      attemptId: input.attempt.id,
      runId: input.run.id,
      epoch: input.epoch,
      role: input.run.role,
    });
    const attemptDir = join(options.attemptsDir, input.attempt.id);
    mkdirSync(attemptDir, { recursive: true, mode: 0o700 });
    const catalogPath = writeAttemptCatalog({
      dir: attemptDir,
      gatewayUrl: options.gatewayUrl,
      capability: capability.token,
      modelId: frozen.model.id,
      contextWindow: frozen.model.contextWindow,
      maxOutputTokens: frozen.model.maxOutputTokens,
      reasoning: frozen.profile.reasoning !== 'off',
    });
    log(
      `prepare-run: ${input.run.id} attempt ${input.attempt.id} → ${frozen.provider.providerId}/${frozen.model.id}`,
    );
    return {
      cwd: options.projectRoot,
      agentDir: join(attemptDir, 'agent'),
      provider: frozen.provider.providerId,
      modelId: frozen.model.id,
      tools: [...frozen.profile.toolSubset],
      prompt: promptFor(input, options.store),
      capability: capability.token,
      catalogPath,
    };
  };
}
