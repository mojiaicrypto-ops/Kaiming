/**
 * Formal report tool (P3-e): `agent_report` is how a professional member delivers its result.
 *
 * The host fixes identity (actor, Task, source input, role) and the member only says what it
 * delivered: the kind, a summary, the body and the checks it really ran. The body is written and
 * read back before the row is recorded, a report is never overwritten (a revision is a new result
 * that supersedes the old one), and the kind must be the one the chief asked this member for.
 */
import { RESULT_KINDS, StoreError, digestOf, type ArtifactRef, type ResultCheck, type ResultKind, type Store } from '../store/store.ts';
import { digestOfText } from '../runtime/plan-store.ts';
import { readReportBody, reportRefFor, reportTarget, writeReportBody } from '../runtime/report-store.ts';
import { asRecord, fail, messageOf, ok, readString, readStringArray } from './tool-kit.ts';
import type { DomainTool } from './task-tools.ts';

export interface ReportToolContext {
  readonly store: Store;
  readonly sessionId: string;
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
    description:
      'Deliver the formal result of this work: kind, summary, body or reportRef, basisRefs, verdict, checks.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...RESULT_KINDS] },
        summary: { type: 'string' },
        body: { type: 'string' },
        reportRef: {
          type: 'object',
          properties: {
            storage: { type: 'string', enum: ['project', 'server'] },
            path: { type: 'string' },
            sha256: { type: 'string' },
          },
          required: ['storage', 'path', 'sha256'],
          additionalProperties: false,
        },
        basisRefs: { type: 'array', items: { type: 'string' } },
        candidateId: { type: 'string' },
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
        supersedesResultId: { type: 'string' },
        settlement: { type: 'object' },
      },
      required: ['kind', 'summary'],
      additionalProperties: false,
    },
    async execute(_toolCallId, rawParams) {
      const context = contextOf();
      const params = asRecord(rawParams);
      if (params === undefined) {
        return fail('INVALID_ARGUMENT', 'params must be an object');
      }
      const kind = readString(params, 'kind');
      const summary = readString(params, 'summary');
      if (kind === undefined || !RESULT_KINDS.includes(kind as ResultKind)) {
        return fail('INVALID_ARGUMENT', `kind must be one of ${RESULT_KINDS.join(', ')}`);
      }
      if (summary === undefined || summary.trim() === '') {
        return fail('INVALID_ARGUMENT', 'summary must be a non-empty string');
      }
      const body = readString(params, 'body');
      const reportRef = parseRef(params['reportRef']);
      if ((body === undefined) === (reportRef === undefined)) {
        return fail('INVALID_ARGUMENT', 'provide exactly one of body or reportRef');
      }
      if (params['reportRef'] !== undefined && reportRef === undefined) {
        return fail('INVALID_ARGUMENT', 'reportRef needs storage, path and sha256');
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
      if (member.expectedKind !== kind) {
        return fail('INVALID_ARGUMENT', `this member was asked for a ${member.expectedKind} report`, {
          expected: member.expectedKind,
          kind,
        });
      }

      // The id is derived from every field the report carries, so a retry of the very same report maps
      // to the same result while two different reports of one input can never collide.
      const resultId = `r-${digestOfText(
        [
          task.id,
          context.sessionId,
          context.inputId,
          kind,
          digestOfText(summary),
          body !== undefined
            ? `body:${digestOfText(body)}`
            : `ref:${reportRef?.storage ?? ''}:${reportRef?.path ?? ''}:${reportRef?.sha256 ?? ''}`,
          `verdict:${verdictRaw ?? ''}`,
          `candidate:${readString(params, 'candidateId') ?? ''}`,
          `checks:${digestOf(checks)}`,
          `basis:${digestOf(readStringArray(params, 'basisRefs') ?? [])}`,
          `supersedes:${readString(params, 'supersedesResultId') ?? ''}`,
          `settlement:${digestOf(params['settlement'] ?? null)}`,
        ].join('|'),
      ).slice(0, 16)}`;
      let bodyRef: ArtifactRef;
      if (reportRef !== undefined) {
        const existing = readReportBody(reportRef);
        if (!existing.current) {
          return fail('VERSION_CONFLICT', 'the referenced report body is missing or changed', {
            path: reportRef.path,
            expected: reportRef.sha256,
          });
        }
        bodyRef = reportRef;
      } else {
        const target = reportTarget({
          taskType: task.type,
          cwd: context.cwd,
          serverWorkDir: context.serverWorkDir,
          taskId: task.id,
          sessionId: context.sessionId,
          resultId,
        });
        bodyRef = reportRefFor(target, body ?? '');
        try {
          writeReportBody(target, body ?? '');
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
      }

      try {
        const recorded = context.store.recordResult({
          resultId,
          taskId: task.id,
          sessionId: context.sessionId,
          inputId: context.inputId,
          roleId: context.roleId,
          kind: kind as ResultKind,
          summary,
          ...(verdictRaw !== undefined ? { verdict: verdictRaw } : {}),
          ...(readString(params, 'candidateId') !== undefined
            ? { candidateId: readString(params, 'candidateId') as string }
            : {}),
          bodyRef,
          basisRefs: readStringArray(params, 'basisRefs') ?? [],
          checks,
          ...(readString(params, 'supersedesResultId') !== undefined
            ? { supersedesResultId: readString(params, 'supersedesResultId') as string }
            : {}),
          ...(params['settlement'] !== undefined ? { settlement: params['settlement'] } : {}),
        });
        return ok(`Report ${recorded.resultId} (${recorded.kind}) recorded for Task ${recorded.taskId}`, {
          resultId: recorded.resultId,
          taskId: recorded.taskId,
          kind: recorded.kind,
          verdict: recorded.verdict,
          reportRef: recorded.bodyRef,
        });
      } catch (error) {
        // A retry of the very same report is not a new result: report the already-recorded one.
        if (error instanceof StoreError && error.code === 'REQUEST_CONFLICT') {
          const existing = context.store.getResult(resultId);
          if (existing !== undefined && existing.bodyRef.sha256 === bodyRef.sha256) {
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

function parseRef(value: unknown): ArtifactRef | undefined {
  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const storage = record['storage'];
  const path = record['path'];
  const sha256 = record['sha256'];
  if ((storage !== 'project' && storage !== 'server') || typeof path !== 'string' || typeof sha256 !== 'string') {
    return undefined;
  }
  return { storage, path, sha256 };
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
    const status = record['status'];
    if (name === undefined || !CHECK_STATUSES.includes(status as (typeof CHECK_STATUSES)[number])) {
      return undefined;
    }
    const command = readString(record, 'command');
    const reason = readString(record, 'reason');
    const evidenceRefs = readStringArray(record, 'evidenceRefs');
    const exitCode = record['exitCode'];
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
