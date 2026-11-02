/**
 * Formal report tool (P3-e): `agent_report` is how a professional member delivers its result.
 *
 * The host fixes identity (actor, Task, source input, role) and the kind this member must deliver
 * (fixed at dispatch); the member only says what it really did: a summary, the body and the checks it
 * ran. The body is written and read back before the row is recorded. For a review or test, the program
 * also observes the delivery the report is about (G3) — the model never names a candidate or a version.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RESULT_KINDS, StoreError, digestOf, type ArtifactRef, type ResultCheck, type ResultKind, type Store } from '../store/store.ts';
import { digestOfPaths, snapshotDelivery, type DeliveryState } from '../runtime/deliverable.ts';
import { digestOfText } from '../runtime/plan-store.ts';
import { knowledgeEntryPaths } from '../runtime/project-store.ts';
import { readReportBody, reportRefFor, reportTarget, writeReportBody } from '../runtime/report-store.ts';
import { asRecord, fail, messageOf, ok, readString, readStringArray } from './tool-kit.ts';
import type { DomainTool } from './task-tools.ts';

export interface ReportToolContext {
  readonly store: Store;
  readonly sessionId: string;
  readonly projectId: string;
  readonly inputId: string;
  readonly roleId: string;
  readonly cwd: string;
  readonly serverWorkDir: string;
}

export type ReportToolContextResolver = () => ReportToolContext;

const CHECK_STATUSES = ['passed', 'failed', 'blocked', 'not_run'] as const;

export function createReportTool(contextOf: ReportToolContextResolver): DomainTool {
  return {
    name: 'agent_report',
    label: 'agent_report',
    description: [
      'Deliver the formal result this step asked you for (its kind is fixed by the dispatch): summary, body, checks.',
      'body is the complete user-visible text; the program stores it and records the delivery state for review/test.',
      'Review and test need a verdict. Use it to report a blocked conclusion that needs the supervisor.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        body: { type: 'string' },
        basisRefs: { type: 'array', items: { type: 'string' } },
        verdict: { type: 'string', enum: ['passed', 'failed', 'blocked'] },
        checks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              status: { type: 'string', enum: [...CHECK_STATUSES] },
              command: { type: 'string' },
              exitCode: { type: 'number' },
              reason: { type: 'string' },
              evidenceRefs: { type: 'array', items: { type: 'string' } },
            },
            required: ['name', 'status'],
            additionalProperties: false,
          },
        },
        settlement: { type: 'object' },
      },
      required: ['summary', 'body'],
      additionalProperties: false,
    },
    async execute(_toolCallId, rawParams) {
      const context = contextOf();
      const params = asRecord(rawParams);
      if (params === undefined) {
        return fail('INVALID_ARGUMENT', 'params must be an object');
      }
      const summary = readString(params, 'summary');
      const body = readString(params, 'body');
      if (summary === undefined || summary.trim() === '') {
        return fail('INVALID_ARGUMENT', 'summary must be a non-empty string');
      }
      if (body === undefined || body.trim() === '') {
        return fail('INVALID_ARGUMENT', 'body must be the complete report text (non-empty)');
      }
      const checks = parseChecks(params['checks']);
      if (checks === undefined) {
        return fail('INVALID_ARGUMENT', 'each check needs a name and a status of passed/failed/blocked/not_run');
      }
      const verdictRaw = params['verdict'];
      if (verdictRaw !== undefined && verdictRaw !== 'passed' && verdictRaw !== 'failed' && verdictRaw !== 'blocked') {
        return fail('INVALID_ARGUMENT', 'verdict must be passed, failed or blocked');
      }
      const member = context.store.getTaskSession(context.sessionId);
      if (member === undefined) {
        return fail('NOT_FOUND', 'this session is not a member of a Task', { sessionId: context.sessionId });
      }
      const task = context.store.getTask(member.taskId);
      if (task === undefined) {
        return fail('NOT_FOUND', `Task ${member.taskId} does not exist`);
      }
      if (member.currentInputId !== context.inputId) {
        return fail('STAGE_NOT_READY', 'the report must be delivered by the input that is running now', {
          currentInputId: member.currentInputId,
          inputId: context.inputId,
        });
      }
      // The kind is what the supervisor asked for, not what the member decides.
      const kind = member.expectedKind as ResultKind;
      if (!RESULT_KINDS.includes(kind)) {
        return fail('INVALID_ARGUMENT', `this member was asked for an unknown report kind (${member.expectedKind})`);
      }
      if ((kind === 'review' || kind === 'test') && verdictRaw === undefined) {
        return fail('INVALID_ARGUMENT', `a ${kind} report needs a verdict`);
      }

      // Delivery binding (G3): observed by the program now, never supplied by the model. A test is
      // measured over the very files the last passed review covered, so the two are comparable even
      // when the test run itself leaves new artifacts behind.
      const delivery = observeDelivery(context, task.id, kind);

      // The id is derived from every field the report carries, so a retry of the very same report maps
      // to the same result while two different reports of one input can never collide.
      const resultId = `r-${digestOfText(
        [
          task.id,
          context.sessionId,
          context.inputId,
          kind,
          digestOfText(summary),
          `body:${digestOfText(body)}`,
          `verdict:${verdictRaw ?? ''}`,
          `checks:${digestOf(checks)}`,
          `basis:${digestOf(readStringArray(params, 'basisRefs') ?? [])}`,
          `delivery:${delivery?.digest ?? ''}`,
          `settlement:${digestOf(params['settlement'] ?? null)}`,
        ].join('|'),
      ).slice(0, 16)}`;

      const target = reportTarget({
        taskType: task.type,
        cwd: context.cwd,
        serverWorkDir: context.serverWorkDir,
        taskId: task.id,
        sessionId: context.sessionId,
        kind,
        resultId,
      });
      // A settlement body is committed before it is registered (D-07), so its path is predictable and
      // the bytes already on disk must be exactly the body being submitted.
      if (kind === 'settlement') {
        const existing = readFileIfPresent(target.path);
        if (existing !== undefined && existing !== body) {
          return fail(
            'VERSION_CONFLICT',
            'a settlement report file already exists with different content; commit the body you submit',
            { path: target.path },
          );
        }
      }
      const bodyRef: ArtifactRef = reportRefFor(target, body);
      try {
        if (readFileIfPresent(target.path) !== body) {
          writeReportBody(target, body);
        }
      } catch (error) {
        return fail('STORAGE_UNAVAILABLE', `the report body could not be saved: ${messageOf(error)}`, {
          path: target.path,
        });
      }
      if (!readReportBody(bodyRef).current) {
        return fail('STORAGE_UNAVAILABLE', 'the saved report body does not read back as written', {
          path: target.path,
        });
      }

      try {
        const recorded = context.store.recordResult({
          resultId,
          taskId: task.id,
          sessionId: context.sessionId,
          inputId: context.inputId,
          roleId: context.roleId,
          kind,
          summary,
          ...(verdictRaw !== undefined ? { verdict: verdictRaw } : {}),
          ...(delivery !== null ? { deliveryState: delivery } : {}),
          bodyRef,
          basisRefs: readStringArray(params, 'basisRefs') ?? [],
          checks,
          ...(params['settlement'] !== undefined ? { settlement: params['settlement'] } : {}),
        });
        return ok(`Report ${recorded.resultId} (${recorded.kind}) recorded for Task ${recorded.taskId}`, {
          resultId: recorded.resultId,
          taskId: recorded.taskId,
          kind: recorded.kind,
          verdict: recorded.verdict,
          reportRef: recorded.bodyRef,
          ...(recorded.deliveryState !== null
            ? { delivery: { digest: recorded.deliveryState.digest, files: recorded.deliveryState.paths.length } }
            : {}),
        });
      } catch (error) {
        // A retry of the very same report is not a new result: report the already-recorded one.
        if (error instanceof StoreError && error.code === 'REQUEST_CONFLICT') {
          const existing = context.store.getResult(resultId);
          if (existing !== undefined) {
            return ok(`Report ${existing.resultId} (${existing.kind}) was already recorded`, {
              resultId: existing.resultId,
              taskId: existing.taskId,
              kind: existing.kind,
              verdict: existing.verdict,
              reportRef: existing.bodyRef,
            });
          }
        }
        const code = error instanceof StoreError ? error.code : 'STORAGE_UNAVAILABLE';
        return fail(code, messageOf(error), { taskId: task.id });
      }
    },
  };
}

/**
 * What the report is evidence about: the project files the delivery covers. Knowledge entries (the
 * settlement legitimately rewrites them) and host bookkeeping are left out.
 */
function observeDelivery(context: ReportToolContext, taskId: string, kind: ResultKind): DeliveryState | null {
  if (kind !== 'review' && kind !== 'test') {
    return null;
  }
  const project = context.store.getProject(context.projectId);
  const knowledge = knowledgeEntryPaths(project?.initializationRef).map((path) => join(context.cwd, path));
  if (kind === 'test') {
    // The same file set the last passed review covered, so the digests are directly comparable.
    const review = context.store
      .listTaskResults(taskId)
      .filter((result) => result.kind === 'review' && result.verdict === 'passed')
      .at(-1);
    if (review?.deliveryState != null) {
      const paths = review.deliveryState.paths;
      return { digest: digestOfPaths(context.cwd, paths), paths };
    }
  }
  return scopeReviewDelivery(context.cwd, snapshotDelivery(context.cwd, knowledge));
}

/**
 * Bind a code delivery to its code files. A settlement writes docs and commits after Review/Test;
 * those edits must not force a fresh review or a rerun of an expensive test when the code did not
 * change. A docs-only delivery keeps its docs, so document tasks are still bound to their output.
 */
function scopeReviewDelivery(cwd: string, snapshot: DeliveryState): DeliveryState {
  // Docs (docs/** and root Markdown) are settlement output; only code paths bind the review.
  const codePaths = snapshot.paths.filter((path) => !path.startsWith('docs/') && (path.includes('/') || !path.endsWith('.md')));
  if (codePaths.length === 0 || codePaths.length === snapshot.paths.length) {
    return snapshot;
  }
  return { digest: digestOfPaths(cwd, codePaths), paths: codePaths };
}

function readFileIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** Strict check parsing: a check the program cannot read is refused, never stored as prose. */
function parseChecks(value: unknown): ResultCheck[] | undefined {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const checks: ResultCheck[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (record === undefined) {
      return undefined;
    }
    const name = readString(record, 'name');
    const status = readString(record, 'status');
    if (name === undefined || status === undefined || !CHECK_STATUSES.includes(status as (typeof CHECK_STATUSES)[number])) {
      return undefined;
    }
    const command = readString(record, 'command');
    const exitCode = record['exitCode'];
    const reason = readString(record, 'reason');
    const evidenceRefs = readStringArray(record, 'evidenceRefs');
    if (exitCode !== undefined && typeof exitCode !== 'number') {
      return undefined;
    }
    checks.push({
      name,
      status: status as ResultCheck['status'],
      ...(command !== undefined ? { command } : {}),
      ...(typeof exitCode === 'number' ? { exitCode } : {}),
      ...(reason !== undefined ? { reason } : {}),
      ...(evidenceRefs !== undefined ? { evidenceRefs } : {}),
    });
  }
  return checks;
}
