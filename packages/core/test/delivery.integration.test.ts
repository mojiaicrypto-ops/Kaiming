import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  completionManifestSchema,
  productDefinitionSchema,
  verificationManifestSchema,
  type Artifact,
  type ArtifactKind,
  type CompletionManifest,
  type JsonObject,
  type PlanTask,
  type ProductDefinition,
  type Ref,
  type Role,
  type Scope,
  type VerificationManifest,
} from '@agentdev/contracts';
import {
  BlobStore,
  ProjectStore as Store,
  projectIdFromRoot,
  sha256,
  type ProjectStore,
} from '@agentdev/storage';
import {
  classifyChange,
  documentRouteRules,
  evaluateStageChain,
  stageOrderFor,
  type StageChainInput,
  type StageManifest,
} from '@agentdev/domain';
import { scanEvents } from '../src/events.js';
import {
  ArtifactService,
  FindingService,
  PlanGateService,
  RequirementContinuation,
  RequirementProjection,
  StoreSourceHashPort,
  type PlanDraft,
} from '../src/index.js';

/**
 * End-to-end graded-delivery chains over a real SQLite `ProjectStore` (WP-06 T4).
 *
 * Each chain is driven through the real services — `PlanGateService`,
 * `FindingService`, `DecisionService`, `RequirementContinuation` — against real
 * `.sqlite` rows and content-addressed blobs. The two places where a real
 * integration belongs to a later work package are stubbed by contract, exactly as
 * `docs/delivery/implementation.md` WP-06 requires:
 *
 * - **Run tools / model calls**: no agent is executed; each Run row is the frozen
 *   record of a stage (`configSnapshotId`/`contextSnapshotId`/`dispatchSnapshotId`
 *   are contract hashes), and stage results are the real `stage_result` shape.
 * - **Git CAS**: `CasPort` is a stub that measures the same source hash the Plan
 *   gate measures, so the completion manifest binds a revision the test can check.
 *
 * The VerificationManifest/CompletionManifest records are validated with the
 * shared contracts schemas before they are frozen, so a field the product model
 * does not define cannot pass as delivery evidence.
 */
const ROOT = '/tmp/agentdev-delivery-integration-root';
const PROJECT_ID_HASH = 'a'.repeat(64);
const CONFIG_HASH = sha256('delivery-integration-config-snapshot');
const REVISION = 'a'.repeat(40);
const NEXT_REVISION = 'b'.repeat(40);
const PRIOR_REVISION = 'c'.repeat(40);
const KNOWLEDGE_TREE = 'd'.repeat(64);
const PATH = 'packages/core/src/delivery.ts';
const DOC_PATH = 'docs/product/requirements.md';

/** Ids allocated in ascending order so a row's UUIDv7 form is readable. */
const IDS = {
  l1Typos: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0001',
  l2Delivery: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0002',
  l3Migration: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0003',
  documentRoute: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0004',
  findingLoop: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0005',
  pausedWork: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0006',
  cancelledWork: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0007',
  upgradeWork: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0008',
} as const;

const PATHS = {
  l1Typo: 'docs/product/experience.md',
} as const;

const AUTH = {
  l1: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0101',
  l2: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0102',
  l3: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0103',
  document: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0104',
  finding: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0105',
  paused: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0106',
  cancelled: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0107',
  upgrade: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0108',
} as const;

const RUNS = {
  l1Plan: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0201',
  l1Develop: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0202',
  l1Review: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0203',
  l1Settlement: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0204',
  l2Plan: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0210',
  l2Develop: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0211',
  l2Review: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0212',
  l2Test: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0213',
  l2Settlement: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0214',
  l3Plan: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0220',
  l3Develop: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0221',
  l3Review: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0222',
  l3Test: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0223',
  l3Recovery: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0224',
  l3Settlement: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0225',
  docProduct: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0230',
  docPlanning: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0231',
  docReview: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0232',
  docSettlement: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0233',
  findingRaise: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0240',
  findingPrefixedReview: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0241',
  findingFix: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0242',
  findingNewReview: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0243',
  findingNewTest: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0244',
  pauseRun: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0250',
  cancelParent: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0260',
  cancelChild: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0261',
  upgradePlanning: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0270',
} as const;

const ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0301';
const TASKS = {
  l1: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0401',
  l2: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0402',
  l3: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0403',
  document: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0404',
  finding: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0405',
  paused: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0406',
  cancelled: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0407',
  upgrade: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0408',
} as const;
const FINDING_MANIFEST_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0410';
const FINDING_TARGET_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0411';
const IMPORTED_REQUIREMENT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0420';
const CONTINUE_ACTION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0421';
const USER_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0422';
const L3_REQUIREMENT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0423';

const SCOPE_L1: Scope = {
  readPaths: [],
  writePaths: [PATHS.l1Typo],
  operations: ['edit'],
  networkTargets: [],
};

const SCOPE_CODE: Scope = {
  readPaths: [],
  writePaths: [PATH],
  operations: ['read', 'edit'],
  networkTargets: [],
};

const SCOPE_L3: Scope = {
  readPaths: [DOC_PATH],
  writePaths: [PATH],
  operations: ['read', 'edit', 'delete_data', 'artifact_write'],
  networkTargets: [],
};

const SCOPE_DOCUMENT: Scope = {
  readPaths: [DOC_PATH],
  writePaths: [DOC_PATH],
  operations: ['read', 'edit'],
  networkTargets: [],
};

const BASE_TIME = Date.parse('2026-09-11T00:00:00.000Z');

/**
 * The stubbed Git port (`reliability.md` §4 step 8).
 *
 * `updateRef` is deliberately compare-and-swap shaped: a caller cannot move
 * `agentdev/main` without naming the revision it observed, which is what the
 * completion manifest then has to agree with.
 */
interface CasPort {
  expectedHead(): string;
  updateRef(name: string, next: string, expectedOld: string): { readonly updated: boolean };
}

interface CasCall {
  readonly name: string;
  readonly next: string;
  readonly expectedOld: string;
}

/**
 * A deterministic UUIDv7-shaped id derived from a seed.
 *
 * `contextSnapshotId`/`environmentRef` in the contract are entity ids, not free
 * text, so the fixture has to mint real ids rather than readable labels. The value
 * is a pure function of the seed — never an allocation counter — so the ids do not
 * depend on which test ran first.
 */
const uuidCache = new Map<string, string>();

function uuidFor(seed: string): string {
  const cached = uuidCache.get(seed);
  if (cached !== undefined) return cached;
  const hex = sha256(seed);
  // version 7 and the RFC 4122 variant bits, so the id passes the shared schema.
  const value = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-8${hex.slice(
    17,
    20,
  )}-${hex.slice(20, 32)}`;
  uuidCache.set(seed, value);
  return value;
}

describe('graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089)', () => {
  let dataDir: string;
  let store: ProjectStore;
  let projectId: string;
  let blobs: BlobStore;
  let artifacts: ArtifactService;
  let gates: PlanGateService;
  let findings: FindingService;
  let cas: CasPort & { readonly calls: CasCall[] };
  let clock: number;
  let runCount: number;

  const time = (): string => {
    clock += 1_000;
    return new Date(clock).toISOString();
  };

  beforeEach(() => {
    clock = BASE_TIME;
    runCount = 0;
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-delivery-'));
    store = Store.open({
      dataDir,
      canonicalRoot: ROOT,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    projectId = projectIdFromRoot(ROOT);
    store.projects.insert({
      id: projectId,
      root: ROOT,
      codeRoot: 'packages',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
    });
    blobs = new BlobStore({ root: dataDir });
    artifacts = new ArtifactService({ store, blobs, now: () => (clock += 1_000) });
    gates = new PlanGateService({ store, artifacts, blobs });
    findings = new FindingService({ store, artifacts, blobs });

    const calls: CasCall[] = [];
    let currentRef = REVISION;
    cas = {
      calls,
      expectedHead: (): string => currentRef,
      updateRef: (name, next, expectedOld) => {
        calls.push({ name, next, expectedOld });
        // The stub is the documented CAS: only the observed old revision moves.
        if (expectedOld !== currentRef) return { updated: false };
        currentRef = next;
        return { updated: true };
      },
    };

    addWork(IDS.l1Typos, 'L1', AUTH.l1, undefined, SCOPE_L1);
    addWork(IDS.l2Delivery, 'L2', AUTH.l2, L3_REQUIREMENT_ID, SCOPE_CODE);
    addWork(IDS.l3Migration, 'L3', AUTH.l3, L3_REQUIREMENT_ID, SCOPE_L3);
    addWork(IDS.documentRoute, 'L2', AUTH.document, undefined, SCOPE_DOCUMENT, 'document');
    addWork(IDS.findingLoop, 'L2', AUTH.finding, undefined, SCOPE_CODE);
    addWork(IDS.pausedWork, 'L2', AUTH.paused, undefined, SCOPE_CODE);
    addWork(IDS.cancelledWork, 'L2', AUTH.cancelled, undefined, SCOPE_CODE);
    addWork(IDS.upgradeWork, 'L1', AUTH.upgrade, undefined, SCOPE_CODE);

    store.requirements.insert({
      id: L3_REQUIREMENT_ID,
      projectId,
      workId: IDS.l2Delivery,
      title: 'Migrate the delivery tables',
      goal: 'move the delivery rows to the new schema',
      lifecycle: 'active',
      phase: 'execute',
      sourceRef: { kind: 'message', id: IDS.l2Delivery, version: '1' },
      recordVersion: 1,
      portableRef: {
        path: `.agentdev/requirements/${L3_REQUIREMENT_ID}`,
        revision: 'working-tree',
        hash: PROJECT_ID_HASH,
      },
      executionAvailability: 'local',
      evidenceAvailability: 'full',
    });

    // An L1 Work is a one-sentence Plan written by the Chief: there is no Planning
    // Run to produce it, and this Run row only exists because a Plan belongs to a
    // Run (`data.ts` `artifact`). Nothing else about L1 needs an agent Run.
    addRun({ id: RUNS.l1Plan, workId: IDS.l1Typos, role: 'chief', stage: 'CompactPlan' });
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Fixtures
  // -------------------------------------------------------------------------

  function addWork(
    id: string,
    level: 'L1' | 'L2' | 'L3',
    authorizationId: string,
    requirementId?: string,
    scope: Scope = SCOPE_CODE,
    intent: 'delivery' | 'document' = 'delivery',
  ): void {
    const budget = store.budgets.insert({
      projectId,
      workId: id,
      tokenLimit: 100_000,
      tokensUsed: 0,
      tokensReserved: 0,
      activeTimeLimit: 600,
      activeTimeUsed: 0,
      repairLimit: 3,
      repairUsed: 0,
      costKnown: true,
    });
    store.works.insert({
      id,
      projectId,
      intent,
      purpose: 'deliver WP-06 T4',
      level,
      goal: `deliver ${id}`,
      scope,
      sourceRef: { kind: 'message', id, version: '1' },
      authorizationRef: authorizationId,
      ...(requirementId === undefined ? {} : { requirementId }),
      status: 'running',
      blockerIds: [],
      baseRevision: REVISION,
      budgetId: budget.id,
      policyRevision: 1,
    });
    const operations = scope.operations;
    store.authorizations.insert({
      id: authorizationId,
      projectId,
      sourceRef: { kind: 'message', id, version: '1' },
      workId: id,
      goal: `authorized scope for ${id}`,
      scope,
      operations,
      acceptedAt: '2026-09-11T00:00:00.000Z',
    });
  }

  function addRun(input: {
    readonly id: string;
    readonly workId: string;
    readonly role: Role;
    readonly stage: string;
    readonly status?: 'running' | 'completed' | 'queued';
    readonly taskId?: string;
    readonly parentRunId?: string;
    readonly childIds?: readonly string[];
  }): void {
    store.runs.insert({
      id: input.id,
      projectId,
      workId: input.workId,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      role: input.role,
      purpose:
        input.role === 'review'
          ? 'review'
          : input.role === 'test'
            ? 'test'
            : input.role === 'settlement'
              ? 'settlement'
              : 'implementation',
      stage: input.stage,
      status: input.status ?? 'completed',
      requiredChild: false,
      join: 'none',
      childIds: [...(input.childIds ?? [])],
      configSnapshotId: CONFIG_HASH,
      contextSnapshotId: sha256(`${input.id}:context`),
      dispatchSnapshotId: sha256(`${input.id}:dispatch`),
      budgetAllocation: 1_000,
      ...(input.parentRunId === undefined ? {} : { parentRunId: input.parentRunId }),
      // The order of the chain is part of its meaning (a fix must precede the
      // Review that verifies it), so Runs created later sort strictly later.
      createdAt: new Date(BASE_TIME + (runCount += 1) * 1_000).toISOString(),
    });
  }

  function artifact(input: {
    readonly runId: string;
    readonly workId: string;
    readonly role: Role;
    readonly kind: ArtifactKind;
    readonly body: string;
    readonly sourceRevision?: string;
  }): Artifact {
    return artifacts.createAgent({
      run: { id: input.runId, workId: input.workId, role: input.role },
      kind: input.kind,
      mime: 'text/markdown',
      bytes: Buffer.from(input.body, 'utf8'),
      ...(input.sourceRevision === undefined ? {} : { sourceRevision: input.sourceRevision }),
    });
  }

  function planTask(id: string, role: Role, acceptanceIds: readonly string[]): PlanTask {
    return {
      id,
      role,
      goal: `deliver ${id}`,
      paths: [PATH],
      dependsOn: [],
      acceptanceIds: [...acceptanceIds],
      checks: ['pnpm test:unit'],
    };
  }

  function draftFor(
    workId: string,
    overrides: Partial<PlanDraft> & { readonly tasks: readonly PlanTask[] },
  ): PlanDraft {
    const scope = workId === IDS.documentRoute ? SCOPE_DOCUMENT : SCOPE_CODE;
    return {
      goal: `implement ${workId}`,
      scope,
      interfaceChanges: [],
      dataChanges: [],
      risks: [],
      rollback: [],
      ...overrides,
    };
  }

  function approvePlan(input: {
    readonly workId: string;
    readonly authorizationRef: string;
    readonly runId: string;
    readonly tasks?: readonly PlanTask[];
    readonly goal?: string;
    readonly scope?: Scope;
    readonly requirementId?: string;
    readonly productChanged?: boolean;
    readonly revision?: string;
  }): Ref {
    const result = gates.submitPlan({
      workId: input.workId,
      revision: input.revision ?? REVISION,
      plan: draftFor(input.workId, {
        goal: input.goal ?? `implement ${input.workId}`,
        tasks: input.tasks ?? [planTask(TASKS.l2, 'backend', ['AC-010'])],
        ...(input.scope === undefined ? {} : { scope: input.scope }),
      }),
      approval: {
        authorizationRef: input.authorizationRef,
        runId: input.runId,
        productChanged: input.productChanged ?? false,
        at: time(),
      },
      ...(input.requirementId === undefined ? {} : { requirementId: input.requirementId }),
    });
    if (!result.approved) {
      throw new Error(`expected an approved Plan, got ${result.code}: ${result.message}`);
    }
    return result.planRef;
  }

  function insertTask(input: {
    readonly id: string;
    readonly workId: string;
    readonly planRef: Ref;
    readonly scope?: Scope;
    readonly acceptanceIds?: readonly string[];
    readonly requirementId?: string;
  }): void {
    store.tasks.insert({
      id: input.id,
      workId: input.workId,
      ...(input.requirementId === undefined ? {} : { requirementId: input.requirementId }),
      planRef: input.planRef,
      role: 'backend',
      dependsOn: [],
      dependencyManifestRefs: [],
      scope: input.scope ?? SCOPE_CODE,
      stage: 'develop',
      acceptanceIds: [...(input.acceptanceIds ?? ['AC-010'])],
    });
  }

  /** A frozen VerificationManifest, validated with the shared contract schema. */
  function stageManifest(input: {
    readonly stage: string;
    readonly workId: string;
    readonly route: string;
    readonly level: 'L1' | 'L2' | 'L3';
    readonly planRef: Ref;
    readonly codeRevision?: string;
    readonly codeTree?: string;
    readonly dependsOn?: readonly string[];
    readonly environmentRef?: string;
    readonly taskId?: string;
    readonly productRef?: Ref;
    readonly acceptanceIds?: readonly string[];
    readonly dependencyManifestRefs?: readonly string[];
    readonly readLedgerSeq?: number;
    readonly readLedgerHash?: string;
  }): VerificationManifest {
    return verificationManifestSchema.parse({
      workId: input.workId,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      level: input.level,
      route: input.route,
      ...(input.productRef === undefined ? {} : { productRef: input.productRef }),
      planRef: input.planRef,
      dependencyRevision: REVISION,
      dependencyManifestRefs: [...(input.dependencyManifestRefs ?? [])],
      codeRevision: input.codeRevision ?? REVISION,
      codeTree: input.codeTree ?? PROJECT_ID_HASH,
      policyHash: CONFIG_HASH,
      contextSnapshotId: uuidFor(`${input.stage}:context`),
      readLedgerSeq: input.readLedgerSeq ?? 0,
      readLedgerHash: input.readLedgerHash ?? PROJECT_ID_HASH,
      configHash: CONFIG_HASH,
      environmentRef: input.environmentRef ?? uuidFor(`${input.stage}:env`),
      acceptanceIds: [...(input.acceptanceIds ?? ['AC-010'])],
    });
  }

  /** The `StageManifest` view the domain chain rules consume. */
  function stageView(input: {
    readonly stage: string;
    readonly workId: string;
    readonly dependsOn?: readonly string[];
    readonly evidence?: readonly string[];
  }): StageManifest {
    return {
      stage: input.stage,
      workId: input.workId,
      planRef: { id: PROJECT_ID_HASH, version: 1, hash: PROJECT_ID_HASH },
      codeRevision: REVISION,
      codeTree: PROJECT_ID_HASH,
      environmentRef: uuidFor(`${input.stage}:env`),
      acceptanceIds: ['AC-010'],
      ...(input.dependsOn === undefined ? {} : { dependsOn: [...input.dependsOn] }),
      ...(input.evidence === undefined ? {} : { evidence: [...input.evidence] }),
    };
  }

  function freezeManifest(
    workId: string,
    stage: string,
    manifest: VerificationManifest,
  ): { readonly id: string; readonly hash: string; readonly payload: JsonObject } {
    const payload: JsonObject = {
      kind: 'verification_manifest',
      schemaVersion: 1,
      workId,
      stage,
      manifest: manifest as unknown as JsonObject,
    };
    const hash = sha256(JSON.stringify(payload));
    store.db
      .prepare(
        'INSERT OR IGNORE INTO snapshot (type, hash, payload, blob_path, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        'verification',
        hash,
        JSON.stringify(payload),
        `snapshots/verification/${hash}.json`,
        time(),
      );
    return { id: hash, hash, payload };
  }

  function freezeCompletion(
    workId: string,
    manifest: CompletionManifest,
  ): { readonly manifest: CompletionManifest; readonly hash: string } {
    const parsed = completionManifestSchema.parse(manifest);
    const payload: JsonObject = {
      kind: 'completion_manifest',
      schemaVersion: 1,
      workId,
      manifest: parsed as unknown as JsonObject,
    };
    const hash = sha256(JSON.stringify(payload));
    store.db
      .prepare(
        'INSERT OR IGNORE INTO snapshot (type, hash, payload, blob_path, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        'verification',
        hash,
        JSON.stringify(payload),
        `snapshots/verification/${hash}.json`,
        time(),
      );
    return { manifest: parsed, hash };
  }

  function stageChain(input: StageChainInput) {
    return evaluateStageChain(input);
  }

  function productDefinition(): ProductDefinition {
    return productDefinitionSchema.parse({
      goal: 'deliver the graded delivery rules',
      scope: SCOPE_CODE,
      behaviors: [
        {
          id: 'BEH-1',
          trigger: 'a validated ProductDefinition exists',
          expected: 'Plan/Develop/Review/Test/Settlement run in order',
          failure: 'the chain reports the missing stage as GATE_NOT_READY',
        },
      ],
      acceptance: [
        {
          id: 'AC-010',
          given: 'a validated Product',
          when: 'L2 delivers',
          then: 'five valid stages',
        },
      ],
      constraints: ['no new dependencies'],
      decisionRefs: [],
      featureRefs: [],
    });
  }

  // -------------------------------------------------------------------------
  // AC-007 — L1 typo chain
  // -------------------------------------------------------------------------

  it('runs the L1 typo chain to a CompletionManifest and CAS with no Planning/Test Run and no board entry (AC-007)', () => {
    // Classification first: the one-line documentation fix is L1 by the documented
    // conservative admission conditions, and it is not a behaviour change.
    const classification = classifyChange({
      filesChanged: 1,
      diffLines: 1,
      changedCharacters: 2,
      signals: {
        presentationOnly: true,
        goalSubstitutionExplicit: true,
        unknownsRemain: false,
      },
    });
    expect(classification).toMatchObject({ level: 'L1', lockdown: false, logicChange: false });
    expect(classification.reasons).toEqual(['L1 conditions all hold']);

    // The one-sentence Plan (CompactPlan) is approved against the user's own scope.
    const planRef = approvePlan({
      workId: IDS.l1Typos,
      authorizationRef: AUTH.l1,
      runId: RUNS.l1Plan,
      goal: 'fix the typo in docs/product/experience.md',
      scope: SCOPE_L1,
      tasks: [planTask(TASKS.l1, 'backend', ['AC-007'])],
    });
    expect(gates.getWorkLevel(IDS.l1Typos)).toBe('L1');

    // The internal Work/Task: no Requirement, no board/Gate row beyond the Plan.
    insertTask({
      id: TASKS.l1,
      workId: IDS.l1Typos,
      planRef,
      scope: SCOPE_L1,
      acceptanceIds: ['AC-007'],
    });
    // The L1 Work is internal to the Chief: no Requirement is bound, so no board
    // card exists for it, and no Gate beyond the Plan was created.
    expect(store.requirements.list({ where: 'work_id = ?', params: [IDS.l1Typos] })).toEqual([]);
    expect(store.tasks.find(TASKS.l1)?.stage).toBe('develop');

    const write = gates.requestCodeWrite({
      workId: IDS.l1Typos,
      revision: REVISION,
      targets: [PATHS.l1Typo],
      planRef,
    });
    expect(write.allowed).toBe(true);
    if (!write.allowed) throw new Error('unreachable');

    addRun({ id: RUNS.l1Develop, workId: IDS.l1Typos, role: 'backend', stage: 'Develop' });
    const diff = artifact({
      runId: RUNS.l1Develop,
      workId: IDS.l1Typos,
      role: 'backend',
      kind: 'diff',
      body: '-exprience\n+experience\n',
      sourceRevision: REVISION,
    });
    addRun({ id: RUNS.l1Review, workId: IDS.l1Typos, role: 'review', stage: 'Review' });
    const review = artifact({
      runId: RUNS.l1Review,
      workId: IDS.l1Typos,
      role: 'review',
      kind: 'review',
      body: '# review: the one-line typo fix matches the requested target\n',
      sourceRevision: REVISION,
    });
    addRun({ id: RUNS.l1Settlement, workId: IDS.l1Typos, role: 'settlement', stage: 'Settlement' });
    const settlement = artifact({
      runId: RUNS.l1Settlement,
      workId: IDS.l1Typos,
      role: 'settlement',
      kind: 'settlement',
      body: '# settlement: experience.md updated, index unaffected\n',
      sourceRevision: REVISION,
    });
    expect([diff.validity, review.validity, settlement.validity]).toEqual([
      'valid',
      'valid',
      'valid',
    ]);

    // The L1 chain is Develop → Review → Settlement: no Test stage, and the route
    // check does not demand code Product/Requirement context for a compact plan.
    const chain = stageChain({
      route: 'code',
      level: 'L1',
      manifests: [
        stageView({ stage: 'Develop', workId: IDS.l1Typos }),
        stageView({ stage: 'Review', workId: IDS.l1Typos, dependsOn: ['Develop'] }),
        stageView({ stage: 'Settlement', workId: IDS.l1Typos, dependsOn: ['Review'] }),
      ],
    });
    expect(chain).toEqual({ ok: true, stages: ['Develop', 'Review', 'Settlement'] });
    // The L1 route itself has no Test stage, so a Test manifest is neither required
    // nor part of the validated order (AC-007's "no Test Run").
    expect(stageOrderFor('code', 'L1')).toEqual(['Develop', 'Review', 'Settlement']);
    expect(stageOrderFor('code', 'L1')).not.toContain('Test');
    expect(stageOrderFor('code', 'L2')).toContain('Test');

    // No Planning and no Test Run exists for this Work, and no board entry: a
    // Requirement row is what the board renders.
    const roles = store.runs
      .list({ where: 'work_id = ?', params: [IDS.l1Typos] })
      .map((run) => run.role);
    expect(roles).toContain('chief');
    expect(roles).not.toContain('planning');
    expect(roles).not.toContain('test');
    expect(store.requirements.list({ where: 'work_id = ?', params: [IDS.l1Typos] })).toEqual([]);
    expect(store.events.latestForEntity(IDS.l1Typos)?.name).toBeDefined();

    // The completion manifest binds the verified evidence and the final revision.
    const completion = freezeCompletion(IDS.l1Typos, {
      workId: IDS.l1Typos,
      verifiedManifestIds: [diff.id, review.id, settlement.id],
      finalRevision: NEXT_REVISION,
      verifiedCodeTree: PROJECT_ID_HASH,
      knowledgeTree: KNOWLEDGE_TREE,
      settlementResultRef: settlement.id,
      riskDecisionIds: [],
    });
    expect(completion.manifest.requirementId).toBeUndefined();
    expect(completion.manifest.verifiedManifestIds).toEqual([diff.id, review.id, settlement.id]);
    expect(completion.hash).toMatch(/^[0-9a-f]{64}$/);

    // The CAS step (stubbed Git): compare-and-swap the delivery ref and then bind
    // the manifest to exactly the revision the ref now points at.
    const expected = cas.expectedHead();
    const swap = cas.updateRef('refs/heads/agentdev/main', NEXT_REVISION, expected);
    expect(swap.updated).toBe(true);
    expect(cas.calls).toEqual([
      { name: 'refs/heads/agentdev/main', next: NEXT_REVISION, expectedOld: REVISION },
    ]);
    expect(completion.manifest.finalRevision).toBe(cas.calls[0]?.next);
    // A stale CAS expectation is refused rather than silently moving the ref.
    expect(cas.updateRef('refs/heads/agentdev/main', PRIOR_REVISION, REVISION).updated).toBe(false);
    expect(cas.expectedHead()).toBe(NEXT_REVISION);
  });

  // -------------------------------------------------------------------------
  // AC-010 — L2 chain
  // -------------------------------------------------------------------------

  it('drives a validated ProductDefinition through Plan/Develop/Review/Test/Settlement in order (AC-010)', () => {
    addRun({ id: RUNS.l2Plan, workId: IDS.l2Delivery, role: 'planning', stage: 'Plan' });
    const product = artifact({
      runId: RUNS.l2Plan,
      workId: IDS.l2Delivery,
      role: 'product',
      kind: 'product',
      body: JSON.stringify(productDefinition()),
    });
    const definition = productDefinitionSchema.parse(
      JSON.parse(Buffer.from(artifacts.read(product)).toString('utf8')),
    );
    expect(definition.acceptance.map((entry) => entry.id)).toEqual(['AC-010']);

    const productRef: Ref = { id: product.id, version: 1, hash: product.contentHash };
    const planRef = approvePlan({
      workId: IDS.l2Delivery,
      authorizationRef: AUTH.l2,
      runId: RUNS.l2Plan,
      requirementId: L3_REQUIREMENT_ID,
      tasks: [planTask(TASKS.l2, 'backend', ['AC-010'])],
    });
    expect(store.requirements.find(L3_REQUIREMENT_ID)?.planRef?.hash).toBe(planRef.hash);
    insertTask({
      id: TASKS.l2,
      workId: IDS.l2Delivery,
      planRef,
      requirementId: L3_REQUIREMENT_ID,
      acceptanceIds: ['AC-010'],
    });

    const stages: readonly string[] = ['Plan', 'Develop', 'Review', 'Test', 'Settlement'];
    const views: StageManifest[] = [];
    const manifests: VerificationManifest[] = [];
    const manifestIds: string[] = [];
    const artifactIds: string[] = [];
    const runFor: Readonly<Record<string, string>> = {
      Plan: RUNS.l2Plan,
      Develop: RUNS.l2Develop,
      Review: RUNS.l2Review,
      Test: RUNS.l2Test,
      Settlement: RUNS.l2Settlement,
    };
    const kindFor: Readonly<Record<string, ArtifactKind>> = {
      Plan: 'plan',
      Develop: 'diff',
      Review: 'review',
      Test: 'test',
      Settlement: 'settlement',
    };
    const roleFor: Readonly<Record<string, Role>> = {
      Plan: 'planning',
      Develop: 'backend',
      Review: 'review',
      Test: 'test',
      Settlement: 'settlement',
    };

    for (const stage of stages) {
      if (stage !== 'Plan') {
        addRun({
          id: runFor[stage] ?? '',
          workId: IDS.l2Delivery,
          role: roleFor[stage] ?? 'backend',
          stage,
          taskId: TASKS.l2,
        });
      }
      // The stage result the Run delivers is a real, hash-addressed artifact of the
      // stage's own kind; the frozen manifest is what binds it to the chain.
      artifactIds.push(
        artifact({
          runId: runFor[stage] ?? '',
          workId: IDS.l2Delivery,
          role: roleFor[stage] ?? 'backend',
          kind: kindFor[stage] ?? 'evidence',
          body: `# ${stage} result for the L2 chain\n`,
          sourceRevision: REVISION,
        }).id,
      );
      const manifest = stageManifest({
        stage,
        workId: IDS.l2Delivery,
        route: 'code',
        level: 'L2',
        planRef,
        taskId: TASKS.l2,
        productRef,
        acceptanceIds: ['AC-010'],
      });
      const frozen = freezeManifest(IDS.l2Delivery, stage, manifest);
      manifests.push(manifest);
      manifestIds.push(frozen.hash);
      views.push(
        stageView({
          stage,
          workId: IDS.l2Delivery,
          ...(views.length === 0 ? {} : { dependsOn: [stages[views.length - 1] ?? ''] }),
        }),
      );

      // Each stage becomes valid before the next is added: the chain is evaluated
      // after every manifest, and the still-missing stages are named.
      const partial = evaluateStageChain({
        route: 'code',
        level: 'L2',
        manifests: views,
        requirement: { requirementId: L3_REQUIREMENT_ID, previousLevel: 'L2' },
      });
      const remaining = stages.slice(views.length);
      if (remaining.length === 0) {
        expect(partial).toEqual({ ok: true, stages: [...stages] });
      } else {
        expect(partial.ok).toBe(false);
        if (partial.ok) throw new Error('unreachable');
        expect(partial.gaps.map((gap) => gap.stage)).toEqual([...remaining]);
        expect(partial.gaps.every((gap) => gap.code === 'GATE_NOT_READY')).toBe(true);
      }
      expect(store.stageResults.count()).toBe(0);
    }

    expect(manifests).toHaveLength(5);
    expect(manifestIds.every((id) => /^[0-9a-f]{64}$/.test(id))).toBe(true);
    // Each stage's own result artifact is stored and still valid: the chain is
    // backed by evidence, not by manifest rows alone.
    expect(artifactIds).toHaveLength(5);
    expect(artifactIds.every((id) => store.artifacts.find(id)?.validity === 'valid')).toBe(true);
    // One Product artifact, the five stage results, and the Plan the gate stored.
    expect(store.artifacts.list({ where: 'work_id = ?', params: [IDS.l2Delivery] })).toHaveLength(
      7,
    );
    // Only the frozen chain makes the Work verifiable: the four non-Plan stages
    // each declare the stage they consumed.
    expect(manifests[1]?.codeRevision).toBe(REVISION);
    expect(manifests[3]?.environmentRef).toBe(uuidFor('Test:env'));
    expect(manifests[3]?.contextSnapshotId).toBe(uuidFor('Test:context'));
    // The environment and context ids are stable for the same seed and different
    // for different stages: the manifests really name distinct inputs.
    expect(manifests[3]?.environmentRef).not.toBe(manifests[2]?.environmentRef);
    // Five frozen stage manifests, plus the one Plan-approval snapshot the gate
    // wrote; the Plan's own approval is a different record kind in the same table.
    const kinds = (
      store.db.prepare("SELECT payload FROM snapshot WHERE type = 'verification'").all() as {
        payload: string;
      }[]
    ).map((row) => (JSON.parse(row.payload) as { kind?: string }).kind);
    expect(kinds.filter((kind) => kind === 'verification_manifest')).toHaveLength(5);
    expect(kinds.filter((kind) => kind === undefined)).toHaveLength(1);

    // A stage chain with no Product/Requirement binding is refused, so the chain
    // above was not passing by omission.
    const unbound = evaluateStageChain({
      route: 'code',
      level: 'L2',
      manifests: views,
    });
    expect(unbound.ok).toBe(false);
    if (unbound.ok) throw new Error('unreachable');
    expect(unbound.code).toBe('MISSING_CONTEXT');
    expect(unbound.gaps.map((gap) => gap.message).join(' ')).toContain('Requirement');
  });

  // -------------------------------------------------------------------------
  // AC-012 — document route
  // -------------------------------------------------------------------------

  it('saves a confirmed design as Product/Planning candidate diffs with an independent Review and Settlement only (AC-012)', () => {
    const rules = documentRouteRules('L2');
    expect(rules).toMatchObject({
      route: 'document',
      stages: ['Product', 'Planning', 'Review', 'Settlement'],
      producesCandidateDiff: true,
      codeTestStage: false,
      developmentRequirement: false,
      independentReview: true,
      settlement: true,
    });
    expect(rules.stages).not.toContain('Test');
    expect(rules.stages).not.toContain('Develop');

    addRun({ id: RUNS.docProduct, workId: IDS.documentRoute, role: 'product', stage: 'Product' });
    const productCandidate = artifact({
      runId: RUNS.docProduct,
      workId: IDS.documentRoute,
      role: 'product',
      kind: 'product',
      body: '# confirmed design: delivery levels\n',
    });
    addRun({
      id: RUNS.docPlanning,
      workId: IDS.documentRoute,
      role: 'planning',
      stage: 'Planning',
    });
    const planningCandidate = artifact({
      runId: RUNS.docPlanning,
      workId: IDS.documentRoute,
      role: 'planning',
      kind: 'diff',
      body: '--- docs/product/requirements.md\n+++ docs/product/requirements.md\n+新结论\n',
    });
    addRun({ id: RUNS.docReview, workId: IDS.documentRoute, role: 'review', stage: 'Review' });
    const documentReview = artifact({
      runId: RUNS.docReview,
      workId: IDS.documentRoute,
      role: 'review',
      kind: 'review',
      body: '# review: candidate diffs match the confirmed design and their sources\n',
    });
    addRun({
      id: RUNS.docSettlement,
      workId: IDS.documentRoute,
      role: 'settlement',
      stage: 'Settlement',
    });
    const documentSettlement = artifact({
      runId: RUNS.docSettlement,
      workId: IDS.documentRoute,
      role: 'settlement',
      kind: 'settlement',
      body: '# settlement: docs and index updated\n',
    });

    // The document route is not the code route: no plan gate, no development
    // Requirement bound to the Work, and no code Test stage in the chain.
    expect(store.requirements.list({ where: 'work_id = ?', params: [IDS.documentRoute] })).toEqual(
      [],
    );
    expect(
      store.runs.list({ where: 'work_id = ?', params: [IDS.documentRoute] }).map((run) => run.role),
    ).not.toContain('test');

    const chain = stageChain({
      route: 'document',
      level: 'L2',
      manifests: [
        stageView({ stage: 'Product', workId: IDS.documentRoute }),
        stageView({ stage: 'Planning', workId: IDS.documentRoute, dependsOn: ['Product'] }),
        stageView({ stage: 'Review', workId: IDS.documentRoute, dependsOn: ['Planning'] }),
        stageView({ stage: 'Settlement', workId: IDS.documentRoute, dependsOn: ['Review'] }),
      ],
    });
    expect(chain).toEqual({ ok: true, stages: ['Product', 'Planning', 'Review', 'Settlement'] });

    // The independent Review and the Settlement are real, readable artifacts.
    expect(store.artifacts.find(documentReview.id)?.validity).toBe('valid');
    expect(Buffer.from(artifacts.read(documentReview)).toString('utf8')).toContain(
      'match the confirmed design',
    );
    expect(store.artifacts.find(documentSettlement.id)?.validity).toBe('valid');
    expect([
      productCandidate.kind,
      planningCandidate.kind,
      documentReview.kind,
      documentSettlement.kind,
    ]).toEqual(['product', 'diff', 'review', 'settlement']);
  });

  // -------------------------------------------------------------------------
  // AC-011 — L3 migration
  // -------------------------------------------------------------------------

  it('requires explicit authorization, rollback, per-item audit and a recovery drill before an L3 migration is implemented (AC-011)', () => {
    const requirement = { requirementId: L3_REQUIREMENT_ID, previousLevel: 'L3' as const };
    const noEvidence = stageChain({
      route: 'code',
      level: 'L3',
      manifests: [
        stageView({ stage: 'Plan', workId: IDS.l3Migration }),
        stageView({ stage: 'Develop', workId: IDS.l3Migration, dependsOn: ['Plan'] }),
        stageView({ stage: 'Review', workId: IDS.l3Migration, dependsOn: ['Develop'] }),
        stageView({ stage: 'Test', workId: IDS.l3Migration, dependsOn: ['Review'] }),
        stageView({ stage: 'Recovery', workId: IDS.l3Migration, dependsOn: ['Test'] }),
        stageView({ stage: 'Settlement', workId: IDS.l3Migration, dependsOn: ['Recovery'] }),
      ],
      requirement,
    });
    expect(noEvidence.ok).toBe(false);
    if (noEvidence.ok) throw new Error('unreachable');
    const missing = noEvidence.gaps.map((gap) => gap.message).join(' ');
    expect(missing).toContain('rollback');
    expect(missing).toContain('audit');
    expect(missing).toContain('drill');

    // The implementation may not start on that evidence gap: the migration write
    // needs the same envelope the chain reports as missing.
    const noAuthorization = gates.submitPlan({
      workId: IDS.l3Migration,
      revision: REVISION,
      plan: draftFor(IDS.l3Migration, {
        goal: 'migrate the delivery tables',
        scope: SCOPE_L3,
        tasks: [planTask(TASKS.l3, 'backend', ['AC-011'])],
      }),
      approval: {
        authorizationRef: AUTH.document,
        runId: RUNS.l3Plan,
        productChanged: false,
        at: time(),
      },
      requirementId: L3_REQUIREMENT_ID,
    });
    expect(noAuthorization.approved).toBe(false);
    if (noAuthorization.approved) throw new Error('unreachable');
    expect(noAuthorization.code).toBe('NOT_AUTHORIZED');

    // The user's explicit migration authorization is what the Plan is approved on.
    addRun({ id: RUNS.l3Plan, workId: IDS.l3Migration, role: 'planning', stage: 'Plan' });
    const planRef = approvePlan({
      workId: IDS.l3Migration,
      authorizationRef: AUTH.l3,
      runId: RUNS.l3Plan,
      requirementId: L3_REQUIREMENT_ID,
      scope: SCOPE_L3,
      tasks: [planTask(TASKS.l3, 'backend', ['AC-011'])],
    });
    expect(store.authorizations.find(AUTH.l3)?.operations).toEqual([
      'read',
      'edit',
      'delete_data',
      'artifact_write',
    ]);
    expect(store.requirements.find(L3_REQUIREMENT_ID)?.planRef?.hash).toBe(planRef.hash);

    addRun({ id: RUNS.l3Develop, workId: IDS.l3Migration, role: 'backend', stage: 'Develop' });
    addRun({ id: RUNS.l3Review, workId: IDS.l3Migration, role: 'review', stage: 'Review' });
    addRun({ id: RUNS.l3Test, workId: IDS.l3Migration, role: 'test', stage: 'Test' });
    addRun({ id: RUNS.l3Recovery, workId: IDS.l3Migration, role: 'backend', stage: 'Recovery' });
    addRun({
      id: RUNS.l3Settlement,
      workId: IDS.l3Migration,
      role: 'settlement',
      stage: 'Settlement',
    });
    const migration = artifact({
      runId: RUNS.l3Develop,
      workId: IDS.l3Migration,
      role: 'backend',
      kind: 'diff',
      body: '-- migration: copy delivery rows into the new schema\n',
    });
    const drill = artifact({
      runId: RUNS.l3Recovery,
      workId: IDS.l3Migration,
      role: 'backend',
      kind: 'recovery',
      body: '# recovery drill: restore the backup into a scratch database and re-run the checks\n',
    });

    const full = stageChain({
      route: 'code',
      level: 'L3',
      manifests: [
        stageView({
          stage: 'Plan',
          workId: IDS.l3Migration,
          evidence: ['rollback plan: revert the migration in reverse table order'],
        }),
        stageView({ stage: 'Develop', workId: IDS.l3Migration, dependsOn: ['Plan'] }),
        stageView({
          stage: 'Review',
          workId: IDS.l3Migration,
          dependsOn: ['Develop'],
          evidence: ['per-item audit: every migrated row accounted for by id range'],
        }),
        stageView({ stage: 'Test', workId: IDS.l3Migration, dependsOn: ['Review'] }),
        stageView({
          stage: 'Recovery',
          workId: IDS.l3Migration,
          dependsOn: ['Test'],
          evidence: ['recovery drill evidence: restore into a scratch database'],
        }),
        stageView({ stage: 'Settlement', workId: IDS.l3Migration, dependsOn: ['Recovery'] }),
      ],
      requirement,
    });
    expect(full).toEqual({
      ok: true,
      stages: ['Plan', 'Develop', 'Review', 'Test', 'Recovery', 'Settlement'],
    });

    // The same evidence set without the explicit authorization is refused: L3 can
    // never be auto-approved (`workflow.md` §2/§4).
    const unauthenticated = stageChain({
      route: 'code',
      level: 'L3',
      manifests: [
        stageView({
          stage: 'Plan',
          workId: IDS.l3Migration,
          evidence: ['rollback plan: revert the migration'],
        }),
        stageView({ stage: 'Develop', workId: IDS.l3Migration, dependsOn: ['Plan'] }),
        stageView({
          stage: 'Review',
          workId: IDS.l3Migration,
          dependsOn: ['Develop'],
          evidence: ['per-item audit'],
        }),
        stageView({ stage: 'Test', workId: IDS.l3Migration, dependsOn: ['Review'] }),
        stageView({
          stage: 'Recovery',
          workId: IDS.l3Migration,
          dependsOn: ['Test'],
          evidence: ['recovery drill evidence'],
        }),
        stageView({ stage: 'Settlement', workId: IDS.l3Migration, dependsOn: ['Recovery'] }),
      ],
      requirement: { requirementId: L3_REQUIREMENT_ID, previousLevel: 'L2' },
    });
    expect(unauthenticated.ok).toBe(false);
    if (unauthenticated.ok) throw new Error('unreachable');
    expect(unauthenticated.code).toBe('MISSING_CONTEXT');
    expect(unauthenticated.gaps.map((gap) => gap.message).join(' ')).toContain('explicit');

    expect(migration.validity).toBe('valid');
    expect(drill.kind).toBe('recovery');
    const completion = freezeCompletion(IDS.l3Migration, {
      workId: IDS.l3Migration,
      requirementId: L3_REQUIREMENT_ID,
      verifiedManifestIds: [migration.id, drill.id],
      finalRevision: NEXT_REVISION,
      verifiedCodeTree: PROJECT_ID_HASH,
      knowledgeTree: KNOWLEDGE_TREE,
      settlementResultRef: drill.id,
      riskDecisionIds: [],
    });
    expect(completion.manifest.requirementId).toBe(L3_REQUIREMENT_ID);
  });

  // -------------------------------------------------------------------------
  // AC-017 / AC-018 / AC-083 — Finding loop
  // -------------------------------------------------------------------------

  it('closes a task-less Review Finding through a fix and a new independent Review/Test, refusing self-verification (AC-017, AC-018, AC-083)', () => {
    // The Review Run exists before the Plan it reviews is approved, so the run
    // order below is the real temporal order of the chain: raise, fix, verify.
    addRun({
      id: RUNS.findingRaise,
      workId: IDS.findingLoop,
      role: 'review',
      stage: 'Review',
    });
    const planRef = approvePlan({
      workId: IDS.findingLoop,
      authorizationRef: AUTH.finding,
      runId: RUNS.findingRaise,
      tasks: [planTask(TASKS.finding, 'backend', ['AC-017', 'AC-018', 'AC-083'])],
    });
    insertTask({
      id: TASKS.finding,
      workId: IDS.findingLoop,
      planRef,
      acceptanceIds: ['AC-017', 'AC-018', 'AC-083'],
    });
    // The task is at `review`: the integration Review is what raises the Finding.
    store.tasks.update(
      TASKS.finding,
      { stage: 'review' },
      store.tasks.find(TASKS.finding)?.version ?? 1,
    );
    const raiseArtifact = artifact({
      runId: RUNS.findingRaise,
      workId: IDS.findingLoop,
      role: 'review',
      kind: 'review',
      body: '# review v1: the integration misses the new gate\n',
      sourceRevision: REVISION,
    });
    const raiseTest = artifact({
      runId: RUNS.findingRaise,
      workId: IDS.findingLoop,
      role: 'test',
      kind: 'test',
      body: '# test v1\n',
      sourceRevision: REVISION,
    });

    // A task-less integration Finding binds the Review target and the Manifest; no
    // `taskId` is fabricated (AC-083).
    const submitted = findings.submitFinding({
      reviewRunId: RUNS.findingRaise,
      target: {
        targetKind: 'integration',
        targetRef: { id: FINDING_TARGET_ID, version: 1, hash: PROJECT_ID_HASH },
      },
      manifestRef: { id: FINDING_MANIFEST_ID, version: 1, hash: PROJECT_ID_HASH },
      finding: {
        description: 'the integration misses the new gate',
        severity: 'P1',
        path: PATH,
        evidenceRefs: [raiseArtifact.id],
      },
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) throw new Error('unreachable');
    const findingId = submitted.finding.id;
    expect(submitted.finding.taskId).toBeUndefined();
    expect(submitted.finding.manifestId).toBe(FINDING_MANIFEST_ID);
    expect(submitted.binding.recordHash).toMatch(/^[0-9a-f]{64}$/);

    // AC-017: the Review row returns the work to development by itself — no human
    // forwarding — and the old Review/Test evidence is invalidated.
    expect(submitted.routing.transition).toBe('return_to_development');
    expect(submitted.invalidatedEvidenceRefs).toEqual(
      expect.arrayContaining([raiseArtifact.id, raiseTest.id]),
    );
    expect(store.artifacts.find(raiseArtifact.id)?.validity).toBe('invalid');
    expect(store.artifacts.find(raiseTest.id)?.validity).toBe('invalid');
    expect(store.tasks.find(TASKS.finding)?.stage).toBe('develop');

    addRun({ id: RUNS.findingFix, workId: IDS.findingLoop, role: 'backend', stage: 'Develop' });
    const fixed = findings.markAddressed({
      findingId,
      actorRole: 'backend',
      fixRunId: RUNS.findingFix,
    });
    expect(fixed.ok).toBe(true);
    if (!fixed.ok) throw new Error('unreachable');
    expect(fixed.finding.state).toBe('addressed');

    // AC-018: the developer that fixed it cannot verify it.
    const selfVerify = findings.verifyFinding({
      findingId,
      actorRole: 'backend',
      reviewRun: { runId: RUNS.findingNewReview },
      testRun: { runId: RUNS.findingNewTest },
    });
    expect(selfVerify.ok).toBe(false);
    if (selfVerify.ok) throw new Error('unreachable');
    expect(selfVerify.code).toBe('NOT_AUTHORIZED');
    expect(store.findings.find(findingId)?.state).toBe('addressed');

    addRun({
      id: RUNS.findingNewReview,
      workId: IDS.findingLoop,
      role: 'review',
      stage: 'Review',
    });
    addRun({ id: RUNS.findingNewTest, workId: IDS.findingLoop, role: 'test', stage: 'Test' });
    const fixDiff = artifact({
      runId: RUNS.findingFix,
      workId: IDS.findingLoop,
      role: 'backend',
      kind: 'diff',
      body: '--- a\n+++ b\n+gate check\n',
      sourceRevision: REVISION,
    });
    const verifiedReview = artifact({
      runId: RUNS.findingNewReview,
      workId: IDS.findingLoop,
      role: 'review',
      kind: 'review',
      body: '# review v2 of the post-fix revision: the gate is now wired in\n',
      sourceRevision: REVISION,
    });
    const verifiedTest = artifact({
      runId: RUNS.findingNewTest,
      workId: IDS.findingLoop,
      role: 'test',
      kind: 'test',
      body: '# test v2: passed\n',
      sourceRevision: REVISION,
    });

    const closed = findings.verifyFinding({
      findingId,
      actorRole: 'review',
      reviewRun: { runId: RUNS.findingNewReview },
      testRun: { runId: RUNS.findingNewTest },
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) throw new Error('unreachable');
    expect(closed.state).toBe('verified');
    expect(closed.reviewRunId).toBe(RUNS.findingNewReview);
    expect(closed.testRunId).toBe(RUNS.findingNewTest);
    expect(store.findings.find(findingId)?.state).toBe('verified');
    expect(store.findings.find(findingId)?.taskId).toBeUndefined();
    expect(scanEvents(store, { names: ['finding.verified'] })).toHaveLength(1);
    expect(fixDiff.validity).toBe('valid');
    expect(verifiedReview.validity).toBe('valid');
    expect(verifiedTest.validity).toBe('valid');

    // The Work can now complete: the blocking Finding is closed.
    expect(store.tasks.find(TASKS.finding)?.stage).toBe('develop');
    const completion = findings.completeWork({
      workId: IDS.findingLoop,
      testResult: { status: 'passed' },
    });
    expect(completion.ok).toBe(true);
  });

  // -------------------------------------------------------------------------
  // AC-020 / AC-021 — pause, resume, cancel
  // -------------------------------------------------------------------------

  it('pauses at a safe point, resumes into a new Attempt, and cancels the Run tree while keeping the artifacts (AC-020, AC-021)', () => {
    addRun({
      id: RUNS.pauseRun,
      workId: IDS.pausedWork,
      role: 'backend',
      stage: 'Develop',
      status: 'running',
    });
    store.attempts.insert({
      id: ATTEMPT_ID,
      runId: RUNS.pauseRun,
      number: 1,
      status: 'running',
      ownerEpoch: 0,
    });

    const paused = findings.pauseWork({ workId: IDS.pausedWork, reason: 'user paused' });
    expect(paused.ok).toBe(true);
    if (!paused.ok) throw new Error('unreachable');
    expect(paused.work.status).toBe('paused');
    expect(paused.previousStatus).toBe('running');
    expect(paused.pausedRuns).toEqual([
      expect.objectContaining({
        runId: RUNS.pauseRun,
        status: 'paused',
        stoppedAttemptIds: [ATTEMPT_ID],
      }),
    ]);
    expect(store.attempts.find(ATTEMPT_ID)?.status).toBe('stopped');
    expect(findings.writeAdmission(RUNS.pauseRun).admitted).toBe(false);

    // The version check guards the resume; a stale caller opens no Attempt.
    const stale = findings.resumeWork({
      workId: IDS.pausedWork,
      expectedWorkVersion: paused.work.version + 1,
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error('unreachable');
    expect(stale.code).toBe('VERSION_CONFLICT');
    expect(store.attempts.count('run_id = ?', [RUNS.pauseRun])).toBe(1);

    const resumed = findings.resumeWork({
      workId: IDS.pausedWork,
      expectedWorkVersion: paused.work.version,
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error('unreachable');
    expect(resumed.work.status).toBe('running');
    expect(resumed.barrierRef).toBe(paused.barrierRef);
    const opened = resumed.attempts.find((entry) => entry.runId === RUNS.pauseRun);
    expect(opened?.number).toBe(2);
    expect(store.attempts.find(opened?.attemptId ?? '')?.status).toBe('starting');
    expect(findings.writeAdmission(RUNS.pauseRun).admitted).toBe(true);

    // Cancel: parent and child Runs end together, the diff stays readable and
    // un-integrated, and the Work passes through cancelling to cancelled.
    addRun({
      id: RUNS.cancelParent,
      workId: IDS.cancelledWork,
      role: 'chief',
      stage: 'Develop',
      status: 'running',
    });
    addRun({
      id: RUNS.cancelChild,
      workId: IDS.cancelledWork,
      role: 'backend',
      stage: 'Develop',
      status: 'running',
      parentRunId: RUNS.cancelParent,
    });
    const parentRow = store.runs.find(RUNS.cancelParent);
    store.runs.update(RUNS.cancelParent, { childIds: [RUNS.cancelChild] }, parentRow?.version ?? 1);
    const candidate = artifact({
      runId: RUNS.cancelParent,
      workId: IDS.cancelledWork,
      role: 'chief',
      kind: 'diff',
      body: 'candidate patch that must not be integrated\n',
    });

    const cancelled = findings.cancelWork({ workId: IDS.cancelledWork, reason: 'user cancelled' });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) throw new Error('unreachable');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.integrated).toBe(false);
    expect(cancelled.recoveryRequired).toBe(false);
    expect(cancelled.cancelledRunIds).toEqual(
      expect.arrayContaining([RUNS.cancelParent, RUNS.cancelChild]),
    );
    expect(store.runs.find(RUNS.cancelParent)?.status).toBe('cancelled');
    expect(store.runs.find(RUNS.cancelChild)?.status).toBe('cancelled');
    expect(cancelled.preservedArtifactIds).toContain(candidate.id);
    expect(store.artifacts.find(candidate.id)?.validity).toBe('valid');
    const statuses = scanEvents(store, { names: ['work.control_changed'] })
      .filter(
        (event) => event.data['workId'] === IDS.cancelledWork && event.data['control'] === 'cancel',
      )
      .map((event) => (typeof event.data['status'] === 'string' ? event.data['status'] : ''));
    expect(statuses[0]).toBe('cancelling');
    expect(statuses.indexOf('cancelling')).toBeLessThan(statuses.indexOf('cancelled'));
    // The other Work was left alone by both controls.
    expect(store.works.find(IDS.pausedWork)?.status).toBe('running');
    expect(store.runs.find(RUNS.pauseRun)?.status).toBe('running');
  });

  // -------------------------------------------------------------------------
  // AC-089 — continue an imported active Requirement
  // -------------------------------------------------------------------------

  it('shows an imported active Requirement as waiting to continue and re-plans it in a new Work without reusing old verification (AC-089)', () => {
    const contentMarkdown = [
      '# imported requirement',
      '',
      '## 目标与背景',
      '继续一个从 Git 导入的进行中需求。',
      '## 范围与行为',
      '重新规划并重新验证。',
      '## 验收说明',
      'AC-089。',
      '## 已确认决定',
      '无',
      '## 未决问题',
      '无',
      '## 完成摘要',
      '无',
      '',
    ].join('\n');
    const projection = new RequirementProjection({ store });
    const imported = projection.import({
      record: {
        schemaVersion: 1,
        id: IMPORTED_REQUIREMENT_ID,
        version: 1,
        contentFile: 'content.md',
        contentHash: sha256(contentMarkdown),
        createdAt: '2026-09-11T00:00:00.000Z',
        updatedAt: '2026-09-11T00:00:00.000Z',
        title: 'Keep the imported requirement going',
        goal: 'resume the imported requirement',
        scope: SCOPE_CODE,
        lifecycle: 'active',
        featureIds: [],
        acceptance: [{ id: 'AC-089', given: 'a Git record', when: 'continue', then: 'a Work' }],
        openQuestions: [],
        confirmedDecisions: [],
        relatedRequirementIds: [],
        contentMarkdown,
      },
      portableRef: {
        path: `.agentdev/requirements/${IMPORTED_REQUIREMENT_ID}`,
        revision: REVISION,
      },
    });
    expect(imported.verdict).toBe('new');
    expect(store.requirements.find(IMPORTED_REQUIREMENT_ID)?.executionAvailability).toBe(
      'needs_replan',
    );

    const continuation = new RequirementContinuation({ store });
    const cursorBefore = store.events.latestCursor();
    const listed = continuation.listContinuable();
    expect(listed.items.map((item) => item.requirementId)).toContain(IMPORTED_REQUIREMENT_ID);
    const waiting = listed.items.find((item) => item.requirementId === IMPORTED_REQUIREMENT_ID);
    expect(waiting).toMatchObject({
      waitingToContinue: true,
      lifecycle: 'active',
      executionAvailability: 'needs_replan',
      evidenceAvailability: 'summary_only',
    });
    // Looking at the queue starts nothing.
    expect(store.events.latestCursor()).toBe(cursorBefore);
    expect(store.works.count()).toBe(8);

    // The user's continue command is a real local user action.
    store.userActions.insert({
      id: CONTINUE_ACTION_ID,
      actorId: USER_ID,
      action: 'requirement.continue',
      targetId: IMPORTED_REQUIREMENT_ID,
      payload: { requirementId: IMPORTED_REQUIREMENT_ID },
      payloadHash: PROJECT_ID_HASH,
    });
    const resumed = continuation.continueRequirement({
      requirementId: IMPORTED_REQUIREMENT_ID,
      authorizationRef: CONTINUE_ACTION_ID,
      baseRevision: REVISION,
      at: time(),
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error('unreachable');
    expect(resumed.work.status).toBe('queued');
    expect(resumed.work.requirementId).toBe(IMPORTED_REQUIREMENT_ID);
    expect(resumed.work.authorizationRef).toBe(resumed.authorization.id);
    expect(resumed.authorization.sourceRef).toEqual({
      kind: 'action',
      id: CONTINUE_ACTION_ID,
      version: '1',
    });
    expect(store.requirements.find(IMPORTED_REQUIREMENT_ID)).toMatchObject({
      workId: resumed.work.id,
      executionAvailability: 'local',
      phase: 'product',
      recordVersion: 2,
    });
    expect(resumed.unmetGates.map((gate) => gate.gate)).toEqual([
      'Plan',
      'Develop',
      'Review',
      'Test',
      'Settlement',
    ]);
    expect(resumed.unmetGates.every((gate) => gate.code === 'GATE_NOT_READY')).toBe(true);
    expect(resumed.reusedPreviousVerification).toBe(false);
    expect(resumed.reusedManifestIds).toEqual([]);
    // Continuing plans; it does not start execution.
    expect(store.runs.count()).toBe(1);
    expect(store.runs.find(RUNS.l1Plan)?.workId).toBe(IDS.l1Typos);
    expect(store.stageResults.count()).toBe(0);
    expect(scanEvents(store, { names: ['requirement.changed'] }).at(-1)?.entityId).toBe(
      IMPORTED_REQUIREMENT_ID,
    );
  });

  // -------------------------------------------------------------------------
  // AC-009 / AC-013 — an upgrade refuses the old Plan
  // -------------------------------------------------------------------------

  it('refuses the superseded Plan after an upgrade and leaves the source hash unchanged (AC-009, AC-013)', () => {
    addRun({ id: RUNS.upgradePlanning, workId: IDS.upgradeWork, role: 'planning', stage: 'Plan' });
    const original = approvePlan({
      workId: IDS.upgradeWork,
      authorizationRef: AUTH.upgrade,
      runId: RUNS.upgradePlanning,
      tasks: [planTask(TASKS.upgrade, 'backend', ['AC-013'])],
    });
    const port = new StoreSourceHashPort({ store });
    expect(
      gates.requestCodeWrite({
        workId: IDS.upgradeWork,
        revision: REVISION,
        targets: [PATH],
        planRef: original,
      }).allowed,
    ).toBe(true);

    const replacement = approvePlan({
      workId: IDS.upgradeWork,
      authorizationRef: AUTH.upgrade,
      runId: RUNS.upgradePlanning,
      goal: 'complete the wider delivery',
      tasks: [
        planTask(TASKS.upgrade, 'backend', ['AC-013']),
        planTask('018f2c1e-9a4b-7c3d-8e5f-0a1b2c6d0409', 'backend', ['AC-013']),
      ],
    });
    const upgrade = gates.upgradeLevel({
      workId: IDS.upgradeWork,
      diff: {
        filesChanged: 4,
        diffLines: 24,
        signals: { presentationOnly: true, goalSubstitutionExplicit: true },
      },
      logicChange: false,
      newPlanRef: replacement,
    });
    expect(upgrade.upgraded).toBe(true);
    if (!upgrade.upgraded) throw new Error('unreachable');
    expect(upgrade.level).toBe('L2');
    expect(upgrade.stalePlanRefs).toEqual([original.hash]);
    // The Work keeps its revision, the Requirement association and its evidence;
    // the current Plan for that revision is now the replacement.
    const approval = gates.getCurrentPlanApproval(IDS.upgradeWork, REVISION);
    expect(approval.status).toBe('approved');
    expect(approval.current?.planRef.hash).toBe(replacement.hash);
    expect(store.artifacts.find(original.id)?.validity).toBe('invalid');
    expect(store.artifacts.find(original.id)?.invalidReason).toContain('level upgrade');
    expect(scanEvents(store, { names: ['delivery.level_upgraded'] })).toHaveLength(1);

    // The old Plan cannot authorise a write, and the refusal writes nothing: the
    // measured source (content + gate-written rows) is identical before and after.
    const before = port.snapshot(IDS.upgradeWork);
    const refused = gates.requestCodeWrite({
      workId: IDS.upgradeWork,
      revision: REVISION,
      targets: [PATH],
      planRef: original,
    });
    expect(refused.allowed).toBe(false);
    if (refused.allowed) throw new Error('unreachable');
    expect(refused.code).toBe('GATE_NOT_READY');
    expect(refused.stalePlan).toBe(true);
    expect(refused.sourceHash).toBe(refused.sourceHashAfter);
    expect(refused.currentPlanRef?.hash).toBe(replacement.hash);
    expect(port.snapshot(IDS.upgradeWork).digest).toBe(before.digest);

    const current = gates.requestCodeWrite({
      workId: IDS.upgradeWork,
      revision: REVISION,
      targets: [PATH],
      planRef: replacement,
    });
    expect(current.allowed).toBe(true);
  });
});
