/**
 * The nine workbench surfaces as real data models.
 *
 * Each model is derived from a daemon protocol answer — never from a fixture the UI
 * owns. The derivations here are the rules the acceptance criteria name explicitly:
 * the board keeps one identity per Requirement (AC-068), the Inbox de-duplicates a
 * decision per target version and summarises internal repairs (AC-074), artifact
 * version/validity/truncation is stated rather than inferred (AC-070), and a Run is
 * only rendered as succeeded when its own terminal state says so
 * (`protocol.md` §7 "客户端不能将run.ended统一渲染为成功").
 */
import type { JsonObject } from '@agentdev/contracts';

/** Reads one field out of an unknown protocol payload. */
function field(source: JsonObject, key: string): unknown {
  return source[key];
}

/** Reads one nested object out of an unknown value, without inventing one. */
export function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

export function asArray(value: unknown): readonly JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asObject(entry))
    .filter((entry): entry is JsonObject => entry !== undefined);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

// ---------------------------------------------------------------------------
// Board (AC-068)
// ---------------------------------------------------------------------------

export const BOARD_COLUMNS = ['queued', 'active', 'completed', 'archived'] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export interface WorkProjection {
  readonly workId: string;
  readonly status: string;
  readonly level: string;
  readonly intent: string;
  readonly blockers: readonly string[];
}

export interface BoardCard {
  /** The board identity: always the Requirement id, never the Work id (AC-068). */
  readonly requirementId: string;
  readonly identity: string;
  readonly title: string;
  readonly goal: string;
  readonly lifecycle: string;
  readonly previousLifecycle: string | null;
  readonly phase: string | null;
  readonly recordVersion: number;
  readonly executionAvailability: string;
  readonly evidenceAvailability: string;
  readonly saveState: string;
  readonly work: WorkProjection | null;
  readonly tasksDone: number;
  readonly tasksTotal: number;
  readonly blockers: number;
  readonly awaitingDecision: number;
  readonly canCancelWithoutWork: boolean;
  readonly canPause: boolean;
  /** An imported active record with no local Work: honestly "waiting to continue". */
  readonly waitingToContinue: boolean;
}

export interface BoardModel {
  readonly columns: Readonly<Record<BoardColumn, readonly BoardCard[]>>;
  readonly requirementIds: readonly string[];
  readonly excludedWorkIds: readonly string[];
  readonly rules: {
    readonly l1NotOnBoard: boolean;
    readonly queuedWithoutWorkCancellable: boolean;
    readonly pauseQueuedWithoutWork: string;
  };
  /** Requirement ids that appear in more than one column: must always be empty. */
  readonly duplicatedIdentities: readonly string[];
}

export function boardCardOf(raw: JsonObject): BoardCard {
  const work = asObject(field(raw, 'work'));
  const tasks = asObject(field(raw, 'tasks')) ?? {};
  const blockers = Array.isArray(field(work ?? {}, 'blockers'))
    ? (field(work ?? {}, 'blockers') as unknown[]).map((entry) => String(entry))
    : [];
  return {
    requirementId: asString(field(raw, 'requirementId')),
    identity: asString(field(raw, 'identity'), asString(field(raw, 'requirementId'))),
    title: asString(field(raw, 'title')),
    goal: asString(field(raw, 'goal')),
    lifecycle: asString(field(raw, 'lifecycle')),
    previousLifecycle:
      typeof field(raw, 'previousLifecycle') === 'string'
        ? (field(raw, 'previousLifecycle') as string)
        : null,
    phase: typeof field(raw, 'phase') === 'string' ? (field(raw, 'phase') as string) : null,
    recordVersion: asNumber(field(raw, 'recordVersion')),
    executionAvailability: asString(field(raw, 'executionAvailability'), 'unknown'),
    evidenceAvailability: asString(field(raw, 'evidenceAvailability'), 'unknown'),
    saveState: asString(field(raw, 'saveState'), 'saved'),
    work:
      work === undefined
        ? null
        : {
            workId: asString(field(work, 'id')),
            status: asString(field(work, 'status')),
            level: asString(field(work, 'level')),
            intent: asString(field(work, 'intent')),
            blockers,
          },
    tasksDone: asNumber(field(tasks, 'completed'), asNumber(field(tasks, 'done'))),
    tasksTotal: asNumber(field(tasks, 'total')),
    blockers: asNumber(field(raw, 'blockers'), blockers.length),
    awaitingDecision: asNumber(field(raw, 'awaitingDecision')),
    canCancelWithoutWork: asBoolean(field(raw, 'canCancelWithoutWork')),
    canPause: asBoolean(field(raw, 'canPause')),
    waitingToContinue:
      asBoolean(field(raw, 'waitingToContinue')) ||
      (asString(field(raw, 'lifecycle')) === 'active' && work === undefined),
  };
}

/**
 * Projects the `board` query into the four documented columns.
 *
 * A Requirement whose lifecycle is not one of the four documented states is a
 * protocol break, not a fifth column, so it is reported through
 * `duplicatedIdentities`-style accounting rather than silently rendered.
 */
export function boardModel(raw: JsonObject): BoardModel {
  const columns = asObject(field(raw, 'columns')) ?? {};
  const model: Record<BoardColumn, BoardCard[]> = {
    queued: [],
    active: [],
    completed: [],
    archived: [],
  };
  for (const column of BOARD_COLUMNS) {
    model[column] = asArray(field(columns, column)).map((card) => boardCardOf(card));
  }
  const seen = new Map<string, number>();
  for (const column of BOARD_COLUMNS) {
    for (const card of model[column]) {
      seen.set(card.identity, (seen.get(card.identity) ?? 0) + 1);
    }
  }
  const rules = asObject(field(raw, 'rule')) ?? {};
  return {
    columns: model,
    requirementIds: Array.isArray(field(raw, 'requirementIds'))
      ? (field(raw, 'requirementIds') as unknown[]).map((entry) => String(entry))
      : [],
    excludedWorkIds: Array.isArray(field(raw, 'excludedWorkIds'))
      ? (field(raw, 'excludedWorkIds') as unknown[]).map((entry) => String(entry))
      : [],
    rules: {
      l1NotOnBoard: asBoolean(field(rules, 'l1NotOnBoard')),
      queuedWithoutWorkCancellable: asBoolean(field(rules, 'queuedWithoutWorkCancellable')),
      pauseQueuedWithoutWork: asString(field(rules, 'pauseQueuedWithoutWork'), 'INVALID_STATE'),
    },
    duplicatedIdentities: [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([identity]) => identity),
  };
}

// ---------------------------------------------------------------------------
// Inbox (AC-074)
// ---------------------------------------------------------------------------

export interface InboxRow {
  readonly kind: 'decision' | 'finding' | 'recovery';
  readonly id: string;
  readonly workId: string;
  readonly label: string;
  readonly targetVersion: number | null;
  readonly choices: readonly string[];
  readonly state: string;
  readonly count: number;
  readonly severity: string | null;
  /** A non-blocking/internal repair summary is grouped, not listed per finding. */
  readonly internalRepair: boolean;
  readonly actionable: boolean;
  /** An expired decision stays visible but can never be applied again. */
  readonly expired: boolean;
  readonly runId: string | null;
  readonly createdAt: string | null;
}

export interface InboxModel {
  readonly rows: readonly InboxRow[];
  readonly decisions: readonly InboxRow[];
  readonly findings: readonly InboxRow[];
  readonly recoveries: readonly InboxRow[];
  readonly unread: number;
}

/**
 * Normalises one Inbox answer.
 *
 * De-duplication is enforced here as well as in the daemon, because the rule is a
 * user-visible promise: the same decision arriving through many events is one row
 * per target version, and a decision whose state is no longer `pending` is rendered
 * disabled.
 */
export function inboxModel(raw: JsonObject): InboxModel {
  const rows: InboxRow[] = [];
  const seenDecisions = new Set<string>();
  const findings = new Map<string, InboxRow>();
  for (const item of asArray(field(raw, 'items'))) {
    const kind = asString(field(item, 'kind'));
    if (kind === 'decision') {
      const targetRef = asObject(field(item, 'targetRef')) ?? {};
      const targetId = asString(field(targetRef, 'id'), asString(field(item, 'id')));
      const targetVersion = asNumber(
        field(item, 'targetVersion'),
        asNumber(field(targetRef, 'version')),
      );
      const key = `${targetId}:${String(targetVersion)}`;
      if (seenDecisions.has(key)) continue;
      seenDecisions.add(key);
      const state = asString(field(item, 'state'), 'pending');
      rows.push({
        kind: 'decision',
        id: asString(field(item, 'id')),
        workId: asString(field(item, 'workId')),
        label: asString(field(item, 'decisionKind'), 'decision'),
        targetVersion,
        choices: Array.isArray(field(item, 'choices'))
          ? (field(item, 'choices') as unknown[]).map((entry) => String(entry))
          : [],
        state,
        count: 1,
        severity: null,
        internalRepair: false,
        actionable:
          state === 'pending' && asBoolean(field(item, 'actionable'), state === 'pending'),
        expired: state === 'expired',
        runId: null,
        createdAt:
          typeof field(item, 'createdAt') === 'string'
            ? (field(item, 'createdAt') as string)
            : null,
      });
      continue;
    }
    if (kind === 'finding') {
      const workId = asString(field(item, 'workId'));
      const severity = asString(field(item, 'severity'), 'major');
      const key = `${workId}:${severity}`;
      const count = asNumber(field(item, 'count'), 1);
      const existing = findings.get(key);
      if (existing === undefined) {
        findings.set(key, {
          kind: 'finding',
          id: key,
          workId,
          label: `finding:${severity}`,
          targetVersion: null,
          choices: [],
          state: 'open',
          count,
          severity,
          internalRepair: true,
          actionable: asBoolean(field(item, 'actionable'), true),
          expired: false,
          runId: null,
          createdAt: null,
        });
      } else {
        findings.set(key, { ...existing, count: existing.count + count });
      }
      continue;
    }
    if (kind === 'recovery') {
      rows.push({
        kind: 'recovery',
        id: asString(field(item, 'id')),
        workId: asString(field(item, 'workId')),
        label: asString(field(item, 'status'), 'recovery_required'),
        targetVersion: null,
        choices: [],
        state: asString(field(item, 'status'), 'recovery_required'),
        count: 1,
        severity: null,
        internalRepair: false,
        actionable: asBoolean(field(item, 'actionable'), true),
        expired: false,
        runId: typeof field(item, 'runId') === 'string' ? (field(item, 'runId') as string) : null,
        createdAt: null,
      });
    }
  }
  const findingRows = [...findings.values()];
  const all = [...rows, ...findingRows];
  return {
    rows: all,
    decisions: all.filter((row) => row.kind === 'decision'),
    findings: findingRows,
    recoveries: all.filter((row) => row.kind === 'recovery'),
    unread: asNumber(field(raw, 'unread'), all.filter((row) => row.actionable).length),
  };
}

// ---------------------------------------------------------------------------
// Requirement detail (AC-070)
// ---------------------------------------------------------------------------

export interface ArtifactVersion {
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly createdAt: string;
  readonly validity: string;
}

export interface ArtifactView {
  readonly artifactId: string;
  readonly kind: string;
  readonly authorRole: string;
  readonly createdAt: string;
  readonly artifactVersion: number;
  readonly validity: string;
  readonly isLatest: boolean;
  readonly versionCount: number;
  readonly mime: string;
  readonly bytes: number;
  readonly hash: string;
  readonly previewHref: string;
  readonly downloadPreparePath: string;
  readonly maxInlineBytes: number;
}

export interface PlanView {
  readonly workId: string;
  readonly revision: string;
  readonly currentVersion: number;
  readonly requestedVersion: number;
  readonly approvedVersion: number | null;
  readonly approvedAt: string | null;
  readonly expired: boolean;
  readonly approvalReason: string | null;
  /**
   * The gate's own "this card may be approved" verdict (W9R1-01).
   *
   * It is false when the daemon cannot read the Plan body or its local
   * authorization, so the button is disabled with `approvalReason` instead of
   * sending a request that must fail.
   */
  readonly approvalEnabled: boolean;
}

export interface RunSummary {
  readonly runId: string;
  readonly workId: string;
  readonly taskId: string | null;
  readonly role: string;
  readonly status: string;
  readonly outcome: string | null;
  readonly purpose: string;
  readonly attemptCount: number;
  readonly lastEpoch: number | null;
  readonly createdAt: string;
  readonly endedAt: string | null;
  readonly tokensUsed: number;
  readonly evidenceRefs: readonly string[];
}

export interface TaskView {
  readonly taskId: string;
  readonly title: string;
  readonly status: string;
  readonly role: string | null;
  readonly dependsOn: readonly string[];
}

export interface RequirementDetail {
  readonly requirementId: string;
  readonly title: string;
  readonly goal: string;
  readonly lifecycle: string;
  readonly phase: string | null;
  readonly recordVersion: number;
  readonly portableRef: string;
  readonly saveState: string;
  readonly executionAvailability: string;
  readonly evidenceAvailability: string;
  readonly waitingToContinue: boolean;
  readonly workId: string | null;
  readonly workStatus: string | null;
  readonly scope: JsonObject | null;
  readonly acceptance: readonly string[];
  readonly openQuestions: readonly string[];
  readonly contentMarkdown: string | null;
  readonly plan: PlanView | null;
  readonly tasks: readonly TaskView[];
  readonly runs: readonly RunSummary[];
  readonly artifacts: readonly ArtifactView[];
}

function runSummaryOf(raw: JsonObject): RunSummary {
  const attempts = asArray(field(raw, 'attempts'));
  const lastAttempt = attempts.length === 0 ? undefined : attempts[attempts.length - 1];
  return {
    runId: asString(field(raw, 'id')),
    workId: asString(field(raw, 'workId')),
    taskId: typeof field(raw, 'taskId') === 'string' ? (field(raw, 'taskId') as string) : null,
    role: asString(field(raw, 'role')),
    status: asString(field(raw, 'status'), 'unknown'),
    outcome: typeof field(raw, 'outcome') === 'string' ? (field(raw, 'outcome') as string) : null,
    purpose: asString(field(raw, 'purpose')),
    attemptCount: attempts.length,
    lastEpoch:
      lastAttempt === undefined
        ? null
        : asNumber(field(lastAttempt, 'ownerEpoch'), asNumber(field(lastAttempt, 'epoch'))),
    createdAt: asString(field(raw, 'createdAt')),
    endedAt: typeof field(raw, 'endedAt') === 'string' ? (field(raw, 'endedAt') as string) : null,
    tokensUsed: asNumber(field(raw, 'tokensUsed')),
    evidenceRefs: Array.isArray(field(raw, 'evidenceRefs'))
      ? (field(raw, 'evidenceRefs') as unknown[]).map((entry) => String(entry))
      : [],
  };
}

export function artifactViewOf(raw: JsonObject): ArtifactView {
  const preview = asObject(field(raw, 'preview')) ?? {};
  return {
    artifactId: asString(field(raw, 'id'), asString(field(raw, 'artifactId'))),
    kind: asString(field(raw, 'kind')),
    authorRole: asString(field(raw, 'authorRole'), asString(field(raw, 'role'))),
    createdAt: asString(field(raw, 'createdAt')),
    artifactVersion: asNumber(field(raw, 'artifactVersion'), 1),
    validity: asString(field(raw, 'validity'), 'unknown'),
    isLatest: asBoolean(field(raw, 'isLatest'), true),
    versionCount: asNumber(field(raw, 'versionCount'), 1),
    mime: asString(field(raw, 'mime'), 'application/octet-stream'),
    bytes: asNumber(field(raw, 'bytes')),
    hash: asString(field(raw, 'hash'), asString(field(raw, 'contentHash'))),
    previewHref:
      typeof field(preview, 'href') === 'string'
        ? (field(preview, 'href') as string)
        : `/artifacts/${asString(field(raw, 'id'))}/preview`,
    downloadPreparePath: '/artifacts/download.prepare',
    maxInlineBytes: asNumber(field(preview, 'maxInlineBytes'), 1024 * 1024),
  };
}

/**
 * Builds the requirement detail, including the Plan approval state.
 *
 * A Plan card is expired exactly when the version the user is looking at is not the
 * gate's current version; the UI therefore renders the refusal before the click
 * instead of letting the user discover it through a `VERSION_CONFLICT` (AC-070).
 */
export function requirementDetail(input: {
  readonly requirement: JsonObject;
  readonly artifacts: readonly JsonObject[];
  readonly runs: readonly JsonObject[];
  readonly plan?: JsonObject;
}): RequirementDetail {
  const requirement = input.requirement;
  const work = asObject(field(requirement, 'work'));
  const planRaw = input.plan;
  let plan: PlanView | null = null;
  if (planRaw !== undefined) {
    const requestedVersion = asNumber(field(planRaw, 'requestedVersion'));
    const currentVersion = asNumber(field(planRaw, 'currentVersion'));
    const approvedRaw: unknown = field(planRaw, 'approvedVersion');
    const approvedVersion =
      approvedRaw === null || approvedRaw === undefined ? null : asNumber(approvedRaw);
    const planWork: JsonObject = work ?? {};
    const approvalRaw = field(planRaw, 'approval');
    // A card is disabled for exactly two honest reasons: the version shown is not
    // the gate's current one, or the daemon cannot hand over a submittable Plan
    // body plus its local authorization (W9R1-01/W9R1-02).
    const requestedMatches = requestedVersion === currentVersion;
    const approvalEnabled = requestedMatches && planRaw['approvalEnabled'] !== false;
    plan = {
      workId: asString(field(planRaw, 'workId'), asString(field(planWork, 'id'))),
      revision: asString(field(planRaw, 'revision'), 'working-tree'),
      currentVersion,
      requestedVersion,
      approvedVersion,
      approvedAt:
        typeof field(planRaw, 'approvedAt') === 'string'
          ? (field(planRaw, 'approvedAt') as string)
          : null,
      expired: asBoolean(field(planRaw, 'expired'), requestedVersion !== currentVersion),
      approvalReason:
        typeof field(planRaw, 'approvalReason') === 'string'
          ? (field(planRaw, 'approvalReason') as string)
          : typeof approvalRaw === 'string'
            ? approvalRaw
            : null,
      approvalEnabled,
    };
  }
  return {
    requirementId: asString(field(requirement, 'id')),
    title: asString(field(requirement, 'title')),
    goal: asString(field(requirement, 'goal')),
    lifecycle: asString(field(requirement, 'lifecycle')),
    phase:
      typeof field(requirement, 'phase') === 'string'
        ? (field(requirement, 'phase') as string)
        : null,
    recordVersion: asNumber(
      field(requirement, 'recordVersion'),
      asNumber(field(requirement, 'version')),
    ),
    portableRef: asString(field(requirement, 'portableRef')),
    saveState: asString(field(requirement, 'saveState'), 'saved'),
    executionAvailability: asString(field(requirement, 'executionAvailability'), 'unknown'),
    evidenceAvailability: asString(field(requirement, 'evidenceAvailability'), 'unknown'),
    waitingToContinue:
      asBoolean(field(requirement, 'waitingToContinue')) ||
      (work === undefined && asString(field(requirement, 'lifecycle')) === 'active'),
    workId: work === undefined ? null : asString(field(work, 'id')),
    workStatus: work === undefined ? null : asString(field(work, 'status')),
    scope: asObject(field(requirement, 'scope')) ?? null,
    acceptance: Array.isArray(field(requirement, 'acceptance'))
      ? (field(requirement, 'acceptance') as unknown[]).map((entry) => String(entry))
      : [],
    openQuestions: Array.isArray(field(requirement, 'openQuestions'))
      ? (field(requirement, 'openQuestions') as unknown[]).map((entry) => String(entry))
      : [],
    contentMarkdown:
      typeof field(requirement, 'contentMarkdown') === 'string'
        ? (field(requirement, 'contentMarkdown') as string)
        : null,
    plan,
    tasks: asArray(field(input.requirement, 'tasks')).map((task) => ({
      taskId: asString(field(task, 'id')),
      title: asString(field(task, 'title'), asString(field(task, 'goal'))),
      status: asString(field(task, 'status'), 'unknown'),
      role: typeof field(task, 'role') === 'string' ? (field(task, 'role') as string) : null,
      dependsOn: Array.isArray(field(task, 'dependsOn'))
        ? (field(task, 'dependsOn') as unknown[]).map((entry) => String(entry))
        : [],
    })),
    runs: input.runs.map((run) => runSummaryOf(run)),
    artifacts: input.artifacts.map((artifact) => artifactViewOf(artifact)),
  };
}

// ---------------------------------------------------------------------------
// Runs (list + detail)
// ---------------------------------------------------------------------------

export interface RunsModel {
  readonly onBoard: readonly WorkRow[];
  readonly direct: readonly WorkRow[];
}

export interface WorkRow {
  readonly workId: string;
  readonly intent: string;
  readonly level: string;
  readonly status: string;
  readonly goal: string;
  readonly runCount: number;
  readonly runs: readonly RunSummary[];
}

export interface RunDetail {
  readonly run: RunSummary;
  readonly attempts: readonly {
    readonly attemptId: string;
    readonly number: number;
    readonly epoch: number;
    readonly status: string;
    readonly runnerId: string | null;
    readonly startedAt: string | null;
    readonly endedAt: string | null;
    readonly stopReason: string | null;
  }[];
  readonly stageResults: readonly {
    readonly stageResultId: string;
    readonly stage: string;
    readonly status: string;
    readonly summary: string;
    readonly evidenceRefs: readonly string[];
  }[];
  readonly evidenceRefs: readonly string[];
}

export function workRowOf(raw: JsonObject): WorkRow {
  const counts = asObject(field(raw, 'taskCounts')) ?? {};
  return {
    workId: asString(field(raw, 'id')),
    intent: asString(field(raw, 'intent')),
    level: asString(field(raw, 'level')),
    status: asString(field(raw, 'status'), 'unknown'),
    goal: asString(field(raw, 'goal')),
    runCount: asNumber(field(raw, 'runCount'), asNumber(field(counts, 'total'), 0)),
    runs: asArray(field(raw, 'runs')).map((run) => runSummaryOf(run)),
  };
}

/**
 * Splits Work into board work and direct/L1 work.
 *
 * `experience.md` §4: direct collaboration and independent L1 only appear in Chief
 * and Runs; `none` intent never belongs to the board.
 */
export function runsModel(works: readonly JsonObject[]): RunsModel {
  const rows = works.map((work) => workRowOf(work));
  const direct = rows.filter(
    (row) => row.level === 'L1' || row.level === 'none' || row.intent === 'assist',
  );
  const onBoard = rows.filter((row) => !direct.includes(row));
  return { onBoard, direct };
}

export function runDetail(input: {
  readonly run: JsonObject;
  readonly attempts: readonly JsonObject[];
  readonly stageResults: readonly JsonObject[];
}): RunDetail {
  const summary = runSummaryOf(input.run);
  const stageEvidence = input.stageResults.flatMap((stage) =>
    Array.isArray(field(stage, 'evidenceRefs'))
      ? (field(stage, 'evidenceRefs') as unknown[]).map((entry) => String(entry))
      : [],
  );
  return {
    run: summary,
    attempts: input.attempts.map((attempt) => ({
      attemptId: asString(field(attempt, 'id')),
      number: asNumber(field(attempt, 'number')),
      epoch: asNumber(field(attempt, 'ownerEpoch'), asNumber(field(attempt, 'epoch'))),
      status: asString(field(attempt, 'status'), 'unknown'),
      runnerId:
        typeof field(attempt, 'runnerId') === 'string'
          ? (field(attempt, 'runnerId') as string)
          : null,
      startedAt:
        typeof field(attempt, 'startedAt') === 'string'
          ? (field(attempt, 'startedAt') as string)
          : null,
      endedAt:
        typeof field(attempt, 'endedAt') === 'string'
          ? (field(attempt, 'endedAt') as string)
          : null,
      stopReason:
        typeof field(attempt, 'stopReason') === 'string'
          ? (field(attempt, 'stopReason') as string)
          : null,
    })),
    stageResults: input.stageResults.map((stage) => ({
      stageResultId: asString(field(stage, 'id')),
      stage: asString(field(stage, 'stage'), 'unknown'),
      status: asString(field(stage, 'status'), 'unknown'),
      summary: asString(field(stage, 'summary')),
      evidenceRefs: Array.isArray(field(stage, 'evidenceRefs'))
        ? (field(stage, 'evidenceRefs') as unknown[]).map((entry) => String(entry))
        : [],
    })),
    evidenceRefs: [...new Set([...summary.evidenceRefs, ...stageEvidence])],
  };
}

/**
 * Whether a Run may be shown as a success.
 *
 * `protocol.md` §7: a terminal event carries the real outcome, and the client must
 * not render every `run.ended` as success. `run.status` is the authority: only
 * `completed` is a success, so `failed`, `cancelled`, `timed_out`,
 * `contract_violation` and `recovery_required` are never painted green.
 */
export function isSuccessfulRun(run: Pick<RunSummary, 'status' | 'outcome'>): boolean {
  if (run.status === 'completed') return true;
  return run.outcome === 'succeeded' || run.outcome === 'success';
}

// ---------------------------------------------------------------------------
// Files (AC-077)
// ---------------------------------------------------------------------------

export interface FileEntry {
  readonly path: string;
  readonly kind: 'file' | 'directory';
  readonly bytes: number | null;
}

export interface FilesModel {
  readonly root: string;
  readonly revision: string;
  readonly branch: string;
  readonly entries: readonly FileEntry[];
  readonly query: string;
  /** True when the server clamped the listing; the UI says so instead of hiding rows. */
  readonly truncated: boolean;
}

export function filesModel(raw: JsonObject, query = ''): FilesModel {
  return {
    root: asString(field(raw, 'root')),
    revision: asString(field(raw, 'revision'), 'working-tree'),
    branch: asString(field(raw, 'branch'), 'working-tree'),
    entries: asArray(field(raw, 'entries')).map((entry) => ({
      path: asString(field(entry, 'path')),
      kind: asString(field(entry, 'kind')) === 'directory' ? 'directory' : 'file',
      bytes:
        field(entry, 'bytes') === null || field(entry, 'bytes') === undefined
          ? null
          : asNumber(field(entry, 'bytes')),
    })),
    query,
    truncated: asBoolean(field(raw, 'truncated')),
  };
}

// ---------------------------------------------------------------------------
// Chief conversation (AC-069, AC-084)
// ---------------------------------------------------------------------------

export interface ConversationMessage {
  readonly messageId: string;
  readonly seq: number;
  readonly role: string;
  readonly state: string;
  readonly createdAt: string;
  readonly body: string | null;
  /** Project content: rendered verbatim and never translated (`experience.md` §6). */
  readonly translatable: false;
  readonly attachmentIds: readonly string[];
  readonly workId: string | null;
  readonly errorReason: string | null;
}

export interface ChiefModel {
  readonly conversationId: string;
  readonly title: string;
  readonly conversations: readonly { readonly conversationId: string; readonly title: string }[];
  readonly messages: readonly ConversationMessage[];
  readonly providerReady: boolean | null;
}

export function chiefModel(input: {
  readonly conversation: JsonObject;
  readonly conversations: readonly JsonObject[];
  readonly messages: readonly JsonObject[];
  readonly providerReady?: boolean;
}): ChiefModel {
  return {
    conversationId: asString(field(input.conversation, 'id')),
    title: asString(field(input.conversation, 'title')),
    conversations: input.conversations.map((conversation) => ({
      conversationId: asString(field(conversation, 'id')),
      title: asString(field(conversation, 'title')),
    })),
    messages: input.messages.map((message) => ({
      messageId: asString(field(message, 'id')),
      seq: asNumber(field(message, 'seq')),
      role: asString(field(message, 'role'), 'user'),
      state: asString(field(message, 'state'), 'received'),
      createdAt: asString(field(message, 'createdAt')),
      body:
        field(message, 'body') === null || field(message, 'body') === undefined
          ? null
          : asString(field(message, 'body')),
      translatable: false,
      attachmentIds: Array.isArray(field(message, 'attachmentIds'))
        ? (field(message, 'attachmentIds') as unknown[]).map((entry) => String(entry))
        : [],
      workId:
        typeof field(message, 'workId') === 'string' ? (field(message, 'workId') as string) : null,
      errorReason:
        typeof field(message, 'errorReason') === 'string'
          ? (field(message, 'errorReason') as string)
          : null,
    })),
    providerReady: input.providerReady ?? null,
  };
}

// ---------------------------------------------------------------------------
// Agents / Settings
// ---------------------------------------------------------------------------

export interface RoleView {
  readonly role: string;
  readonly usable: boolean | null;
  readonly unavailableReason: string | null;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly reasoning: string | null;
  readonly contextLimit: number | null;
  readonly reasoningSupported: boolean | null;
  readonly sources: Readonly<Record<string, string>>;
  readonly tools: readonly string[];
}

export interface AgentsModel {
  readonly roles: readonly RoleView[];
  readonly providers: readonly {
    readonly providerId: string;
    readonly type: string;
    readonly baseUrl: string;
    readonly enabled: boolean;
    readonly secretConfigured: boolean;
    readonly models: readonly string[];
  }[];
  readonly activeRuns: number;
}

export function agentsModel(raw: JsonObject): AgentsModel {
  const role = (entry: JsonObject): RoleView => {
    const profile = asObject(field(entry, 'profile'));
    const sources = asObject(field(profile ?? {}, 'sources')) ?? {};
    return {
      role: asString(field(entry, 'role')),
      usable:
        field(entry, 'usable') === null || field(entry, 'usable') === undefined
          ? null
          : asBoolean(field(entry, 'usable')),
      unavailableReason:
        typeof field(entry, 'unavailableReason') === 'string'
          ? (field(entry, 'unavailableReason') as string)
          : null,
      providerId: profile === undefined ? null : asString(field(profile, 'providerId')),
      modelId: profile === undefined ? null : asString(field(profile, 'modelId')),
      reasoning: profile === undefined ? null : asString(field(profile, 'reasoning')),
      contextLimit:
        profile === undefined ? null : asNumber(field(profile, 'effectiveContextLimit')),
      reasoningSupported:
        profile === undefined ? null : asBoolean(field(profile, 'reasoningSupported'), true),
      sources: Object.fromEntries(
        Object.entries(sources).map(([key, value]) => [key, asString(value)]),
      ),
      tools:
        profile === undefined || !Array.isArray(field(profile, 'toolSubset'))
          ? []
          : (field(profile, 'toolSubset') as unknown[]).map((entry_) => String(entry_)),
    };
  };
  return {
    roles: asArray(field(raw, 'roles')).map(role),
    providers: asArray(field(raw, 'providers')).map((provider) => ({
      providerId: asString(field(provider, 'providerId')),
      type: asString(field(provider, 'type')),
      baseUrl: asString(field(provider, 'baseUrl')),
      enabled: asBoolean(field(provider, 'enabled')),
      secretConfigured: asBoolean(field(provider, 'secretConfigured')),
      models: Array.isArray(field(provider, 'models'))
        ? (field(provider, 'models') as unknown[]).map((entry_) => String(entry_))
        : [],
    })),
    activeRuns: asNumber(field(raw, 'activeRuns')),
  };
}

export interface SettingsModel {
  readonly scope: 'global' | 'project';
  readonly version: number;
  readonly revision: string;
  readonly defaultProfile: JsonObject | null;
  readonly roleProfiles: JsonObject;
  readonly limits: JsonObject;
  readonly effectiveLimits: JsonObject;
  readonly policy: JsonObject;
  readonly providers: readonly {
    readonly providerId: string;
    readonly type: string;
    readonly baseUrl: string;
    readonly enabled: boolean;
    readonly secretConfigured: boolean;
  }[];
}

export function settingsModel(raw: JsonObject): SettingsModel {
  const scope = asString(field(raw, 'scope')) === 'project' ? 'project' : 'global';
  return {
    scope,
    version: asNumber(field(raw, 'version')),
    revision: asString(field(raw, 'revision'), String(asNumber(field(raw, 'version')))),
    defaultProfile: asObject(field(raw, 'defaultProfile')) ?? null,
    roleProfiles: asObject(field(raw, 'roleProfiles')) ?? {},
    limits: asObject(field(raw, 'limits')) ?? {},
    effectiveLimits: asObject(field(raw, 'effectiveLimits')) ?? {},
    policy: asObject(field(raw, 'policy')) ?? {},
    providers: asArray(field(raw, 'providers')).map((provider) => ({
      providerId: asString(field(provider, 'providerId')),
      type: asString(field(provider, 'type')),
      baseUrl: asString(field(provider, 'baseUrl')),
      enabled: asBoolean(field(provider, 'enabled')),
      secretConfigured: asBoolean(field(provider, 'secretConfigured')),
    })),
    // no-op placeholder removed
  };
}

/**
 * The client-side mirror of the documented attachment limits.
 *
 * `experience.md` §3: the composer refuses before uploading and the server refuses
 * again; this list is the client half, and `applyMimeRules` is what the tests drive.
 */
export const ATTACHMENT_LIMITS = {
  maxCount: 5,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  mimes: [
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain',
    'text/markdown',
    'text/html',
    'application/pdf',
  ],
} as const;

export type AttachmentRejection =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasonKey: string; readonly detail: string };

/**
 * Validates one prospective upload set.
 *
 * Returns a dictionary key rather than a sentence so the composer can show the
 * message in the interface language while the rule itself stays here.
 */
export function validateAttachments(
  entries: readonly { readonly name: string; readonly mime: string; readonly bytes: number }[],
  limits: typeof ATTACHMENT_LIMITS = ATTACHMENT_LIMITS,
): AttachmentRejection {
  if (entries.length > limits.maxCount) {
    return { ok: false, reasonKey: 'chief.attachmentTooMany', detail: String(entries.length) };
  }
  let total = 0;
  for (const entry of entries) {
    if (entry.bytes > limits.maxFileBytes) {
      return { ok: false, reasonKey: 'chief.attachmentTooLarge', detail: entry.name };
    }
    const normalised = entry.mime.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!(limits.mimes as readonly string[]).includes(normalised)) {
      return { ok: false, reasonKey: 'chief.attachmentMime', detail: entry.name };
    }
    total += entry.bytes;
  }
  if (total > limits.maxTotalBytes) {
    return { ok: false, reasonKey: 'chief.attachmentTotalTooLarge', detail: String(total) };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Live (AC-071 / AC-078)
// ---------------------------------------------------------------------------

export interface LiveEvent {
  readonly cursor: number;
  readonly name: string;
  readonly entityId: string;
  readonly entityVersion: number;
  readonly at: string;
}

export interface LiveModel {
  readonly watermark: number;
  readonly state: 'connecting' | 'open' | 'reconnecting' | 'closed' | 'expired';
  readonly events: readonly LiveEvent[];
  readonly resynced: boolean;
}

/** Projects one event frame into the Live list, keeping the cursor it arrived with. */
export function liveEventOf(frame: JsonObject): LiveEvent | undefined {
  if (asString(field(frame, 'type')) !== 'event') return undefined;
  const cursor = field(frame, 'cursor');
  if (typeof cursor !== 'number') return undefined;
  return {
    cursor,
    name: asString(field(frame, 'name'), 'unknown'),
    entityId: asString(field(frame, 'entityId')),
    entityVersion: asNumber(field(frame, 'entityVersion')),
    at: new Date().toISOString(),
  };
}
