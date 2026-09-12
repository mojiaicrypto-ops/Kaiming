/**
 * The ContextBuilder (`docs/architecture/context.md` §1, `AC-030`, `AC-031`,
 * `AC-033`, `AC-034`, `AC-036`, `AC-079`, `AC-093`).
 *
 * Every test here is a documented obligation of the builder, not an
 * implementation detail:
 *
 * - the happy path freezes the documented fields *and* copies the content into a
 *   content-addressed directory (`AC-030`);
 * - a selection entry without a reason is rejected before anything is read;
 * - a transcript or a source from another Project is refused with
 *   `CONTEXT_FORBIDDEN` and its content never enters the result (`AC-033`,
 *   `AC-034`);
 * - a genuine missing required input is `MISSING_CONTEXT` with a precise gap and
 *   no frozen snapshot (`AC-031`), while the four documented bootstrap positives
 *   still start (`AC-079`);
 * - a budget overflow names the dropped refs and never injects more (`AC-036`);
 * - a frozen snapshot survives a later edit of its source file, and re-freezing
 *   identical inputs is idempotent (Snapshot 失效);
 * - a reference that does not exist is recorded in `excluded`/`unknowns` instead
 *   of triggering a module expansion (`AC-093`).
 *
 * The ports are real in-memory implementations that mirror what a production
 * Core must do; the immutability test runs against a real file in a temporary
 * directory.
 *
 * Note on `workGoal`: `context.md` §1 names "当前 Work/Task" as an input, but the
 * required-input table keys the logical input `workGoal` — a `.agentdev/work/...`
 * path is not one of the table's documented prefixes (`requirements.ts`
 * `PATH_INPUT_RULES`), so a build whose Work goal is a Git file declares that
 * input through `contextInputs`. This is the caller asserting "here is the Work
 * goal", not the builder guessing.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256 } from '@agentdev/storage';
import {
  buildContext,
  characterTokenCounter,
  contextSnapshotRef,
  createSnapshotDirectoryWriter,
  snapshotIdentityPayload,
  readScopeDigest,
  scopeFor,
  type BuildContextInput,
  type BuildContextResult,
  type ContextInputKey,
  type ContextSnapshot,
  type ContextSourceRef,
  type FetchRef,
  type ReadScope,
  type SnapshotWriterPort,
} from '../src/context/index.js';
import { canonicalJson } from '../src/dispatcher.js';
import { toSourceRefKind } from '../src/context/types.js';
import type { ContextSelection, Hash, SourceRef } from '@agentdev/contracts';

const PROJECT = {
  projectId: '11111111111111111111111111111111',
  codeRoot: 'src',
  documentRoot: 'docs',
  deliveryBranch: 'agentdev/main',
  workId: 'WP-05',
} as const;

const OTHER_PROJECT_ID = '22222222222222222222222222222222';
const RUN_ID = '0191f000-0000-7000-8000-0000000000aa';
const CONFIG_HASH: Hash = 'c'.repeat(64);
const ROLE_CONTRACT_ID = 'backend:contract';
const POLICY_BODY = 'policy revision 1';
const CONTRACT_BODY = '# role contract\n\nImplement only the approved slice.\n';
const AGENTS_MD = '# Agent rules\n\nChief chooses the context; the builder only authorises.\n';
const GOAL_MD = '# WP-05 goal\n\nImplement the ContextBuilder for one Run.\n';
const USER_MESSAGE = 'Implement WP-05 context isolation.\n';
const PLAN_BODY = '# L1 compact plan\n\nChange src/context/builder.ts.\n';
const DESIGN_BODY = '# product design\n\nContext selection is explicit.\n';
const INDEX_BODY = '# document index\n';
/**
 * An oversized optional document: more tokens than the documented minimum budget
 * (`agents.md` §6), so "the budget dropped it" is a real overflow and not a
 * fixture that only fits a sub-minimum ceiling.
 */
const DUMP_BODY = `# history dump\n${'x'.repeat(20_000)}\n`;

/** `characterTokenCounter` of a body, so a test can size its budget exactly. */
const tokensOf = (content: string): number => characterTokenCounter(content);

/** In-memory Git blobs keyed by `path@revision`. */
type BlobSeed = Readonly<Record<string, string>>;

/** In-memory artifacts keyed by id, with the currently frozen version. */
type ArtifactSeed = Readonly<
  Record<string, { readonly version: number; readonly content: string }>
>;

/** The ports a test drives; `input` is what it passes to `buildContext`. */
interface Harness {
  readonly input: BuildContextInput;
  readonly fetches: FetchRef[];
  readonly resolutions: ContextSourceRef[];
}

interface HarnessOptions {
  readonly role?: BuildContextInput['role'];
  readonly stage?: string;
  readonly project?: typeof PROJECT;
  readonly blobs?: BlobSeed;
  readonly artifacts?: ArtifactSeed;
  /** Extra full handles: a source whose `SourceRef` cannot carry its metadata. */
  readonly contextSources?: readonly ContextSourceRef[];
  /** Logical inputs the caller asserts without a resolvable handle. */
  readonly contextInputs?: readonly ContextInputKey[];
  readonly tokenCounter?: (content: string) => number;
  readonly writer?: SnapshotWriterPort;
  readonly now?: () => string;
}

/**
 * One selected source as the Core holds it: the storage `SourceRef` that goes into
 * the selection, plus the full `ContextSourceRef` that carries what a `SourceRef`
 * cannot (a message sender, an artifact class, a Project id).
 */
interface SelectedSource {
  readonly ref: ContextSourceRef;
}

const AGENTS: SelectedSource = {
  ref: {
    kind: 'policy',
    id: 'docs/rules/agents.md',
    version: 'revision-1',
    path: 'docs/rules/agents.md',
  },
};
const WORK_GOAL: SelectedSource = {
  ref: {
    kind: 'git',
    id: '.agentdev/work/WP-05/goal.md',
    version: 'revision-1',
    path: '.agentdev/work/WP-05/goal.md',
  },
};
const USER_REQUEST: SelectedSource = {
  ref: { kind: 'message', id: 'msg-user-1', version: '1', sender: 'user' },
};
const INDEX: SelectedSource = {
  ref: { kind: 'git', id: 'docs/INDEX.md', version: 'revision-1', path: 'docs/INDEX.md' },
};
const CURRENT_FILE: SelectedSource = {
  ref: {
    kind: 'git',
    id: 'src/context/builder.ts',
    version: 'revision-1',
    path: 'src/context/builder.ts',
  },
};
const MISSING: SelectedSource = {
  ref: { kind: 'git', id: 'src/missing.ts', version: 'revision-1', path: 'src/missing.ts' },
};
const DUMP: SelectedSource = {
  ref: {
    kind: 'git',
    id: 'docs/history/dump.md',
    version: 'revision-1',
    path: 'docs/history/dump.md',
  },
};

const ARTIFACT_PLAN = '0191f000-0000-7000-8000-0000000000d2';
const ARTIFACT_PRODUCT = '0191f000-0000-7000-8000-0000000000d3';
const ARTIFACT_FOREIGN = '0191f000-0000-7000-8000-0000000000d9';

/** The full handle of one artifact; the ACL needs its class to classify it. */
function artifact(
  id: string,
  version: number,
  artifactClass: NonNullable<ContextSourceRef['artifactClass']>,
): ContextSourceRef {
  return {
    kind: 'artifact',
    id,
    version: String(version),
    path: `artifacts/${artifactClass}/${id}`,
    artifactClass,
  };
}

/** A canonical artifact `Ref` for `selection.artifactRefs` (id + version). */
function artifactRef(
  id: string,
  version: number,
): { readonly id: string; readonly version: number; readonly hash: Hash } {
  return { id, version, hash: '0'.repeat(64) };
}

/** The base blobs plus a neighbouring module the builder must not pull in. */
function baseBlobsWithNeighbour(): BlobSeed {
  return { ...BASE_BLOBS, 'src/orders/cancel.ts@revision-1': '// neighbour\n' };
}

const BASE_BLOBS: BlobSeed = {
  'docs/rules/agents.md@revision-1': AGENTS_MD,
  '.agentdev/work/WP-05/goal.md@revision-1': GOAL_MD,
  'msg-user-1@1': USER_MESSAGE,
  'docs/INDEX.md@revision-1': INDEX_BODY,
  'src/context/builder.ts@revision-1': '// current implementation\n',
  'docs/history/dump.md@revision-1': DUMP_BODY,
};

/** The assistant route: a policy file, the Work goal and the user's request. */
const ASSIST_SOURCES: readonly SelectedSource[] = [AGENTS, WORK_GOAL, USER_REQUEST];

/** A minimal policy blob so a test can size the budget exactly. */
const TINY_POLICY: SelectedSource = {
  ref: {
    kind: 'policy',
    id: 'docs/rules/tiny.md',
    version: 'revision-1',
    path: 'docs/rules/tiny.md',
  },
};
const TINY_POLICY_BODY = 'x\n';

/** The one logical input the Work goal file supplies. */
const WORK_GOAL_INPUT: readonly ContextInputKey[] = ['workGoal'];

function makeHarness(selection: ContextSelection, options: HarnessOptions = {}): Harness {
  const project = options.project ?? PROJECT;
  const blobs = new Map<string, string>(Object.entries(options.blobs ?? {}));
  const artifacts = new Map<string, { currentVersion: number; content: string }>(
    Object.entries(options.artifacts ?? {}).map(([id, entry]) => [
      id,
      { currentVersion: entry.version, content: entry.content },
    ]),
  );
  const fetches: FetchRef[] = [];
  const resolutions: ContextSourceRef[] = [];
  // The Core holds the full handles next to the narrow selection; the builder
  // merges them by `kind:id` before it evaluates the ACL.
  const contextSources = options.contextSources ?? [];
  void contextSources;

  const resolver = {
    resolve({ ref }: { readonly ref: ContextSourceRef }) {
      resolutions.push(ref);
      if (ref.kind === 'artifact') {
        const entry = artifacts.get(ref.id);
        if (entry === undefined) {
          return {
            ok: false as const,
            code: 'NOT_FOUND' as const,
            message: `artifact ${ref.id} 不存在`,
          };
        }
        if (Number(ref.version) !== entry.currentVersion) {
          return {
            ok: false as const,
            code: 'STALE_ARTIFACT' as const,
            message: `artifact ${ref.id}@${ref.version} 已过期，当前版本 ${entry.currentVersion}`,
          };
        }
        return {
          ok: true as const,
          hash: sha256(entry.content),
          kind: 'artifact' as const,
          version: ref.version,
          fetch: { kind: 'artifact' as const },
          fetchRef: { kind: 'artifact' as const, id: ref.id, version: ref.version },
        };
      }
      const path = ref.path ?? ref.id;
      const blob = blobs.get(`${path}@${ref.version}`);
      if (blob === undefined) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: `${path} 不存在` };
      }
      return {
        ok: true as const,
        hash: sha256(blob),
        kind: ref.kind === 'role_contract' ? ('role_contract' as const) : ('git' as const),
        path,
        revision: ref.version,
        fetch: { kind: 'none' as const },
        content: blob,
      };
    },
  };

  const content = {
    fetch(ref: FetchRef) {
      fetches.push(ref);
      if (ref.kind === 'artifact') {
        const entry = artifacts.get(ref.id);
        if (entry === undefined) {
          return {
            ok: false as const,
            code: 'ARTIFACT_MISSING' as const,
            message: `${ref.id} 缺少内容`,
          };
        }
        return { ok: true as const, content: entry.content };
      }
      const blob = blobs.get(`${ref.path}@${ref.revision}`);
      if (blob === undefined) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: `${ref.path} 缺少内容` };
      }
      return { ok: true as const, content: blob };
    },
  };

  const gates = {
    current() {
      return {
        ok: true as const,
        policyRevision: '1',
        policyContent: POLICY_BODY,
        roleContract: { id: ROLE_CONTRACT_ID, body: CONTRACT_BODY },
      };
    },
  };

  const input: BuildContextInput = {
    selection,
    role: options.role ?? 'chief',
    stage: options.stage ?? 'assist',
    project,
    configHash: CONFIG_HASH,
    runId: RUN_ID,
    workId: project.workId,
    resolver,
    content,
    gates,
    snapshotWriter:
      options.writer ??
      createSnapshotDirectoryWriter({ root: mkdtempSync(join(tmpdir(), 'ctx-')) }),
    ...(options.tokenCounter === undefined ? {} : { tokenCounter: options.tokenCounter }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.contextSources === undefined ? {} : { contextSources: options.contextSources }),
    ...(options.contextInputs === undefined ? {} : { contextInputs: options.contextInputs }),
  };
  return { input, fetches, resolutions };
}

/** A selection with one reason per entry by default. */
function selectionOf(input: {
  readonly sources?: readonly SelectedSource[];
  readonly artifactRefs?: ContextSelection['artifactRefs'];
  /** Explicit reasons; a key mapped to `undefined` removes the auto reason. */
  readonly reasonPerSource?: Readonly<Record<string, string | undefined>>;
  readonly initialTokens?: number;
  readonly goal?: string;
  readonly excluded?: readonly string[];
  readonly unknowns?: readonly string[];
}): ContextSelection {
  const sources = input.sources ?? [];
  const sourceRefs: SourceRef[] = sources.map(({ ref }) => ({
    kind: toSourceRefKind(ref.kind),
    id: ref.id,
    version: ref.version,
    ...(ref.path === undefined ? {} : { path: ref.path }),
  }));
  const reasons: Record<string, string> = {};
  for (const { ref } of sources) {
    reasons[`${toSourceRefKind(ref.kind)}:${ref.id}`] = `选择 ${ref.id} 的原因`;
  }
  for (const artifact of input.artifactRefs ?? []) {
    reasons[`artifact:${artifact.id}`] = `选择产物 ${artifact.id} 的原因`;
  }
  const mergedReasons: Record<string, string> = { ...reasons };
  for (const [key, value] of Object.entries(input.reasonPerSource ?? {})) {
    // `undefined` is an explicit "no reason", which is what the negative tests need.
    if (value === undefined) delete mergedReasons[key];
    else mergedReasons[key] = value;
  }
  return {
    goal: input.goal ?? '实现 WP-05 context 层',
    sourceRefs,
    reasonPerSource: mergedReasons,
    featureRefs: [],
    codePaths: [],
    artifactRefs: [...(input.artifactRefs ?? [])],
    excluded: [...(input.excluded ?? [])],
    unknowns: [...(input.unknowns ?? [])],
    readBudget: { initialTokens: input.initialTokens ?? 24_000, expansionTokens: 16_000 },
  };
}

/** The assistant selection with the metadata overlay the Core supplies. */
function assistHarness(
  options: HarnessOptions & { readonly initialTokens?: number } = {},
): Harness {
  const { initialTokens, ...rest } = options;
  return makeHarness(
    selectionOf({
      sources: ASSIST_SOURCES,
      ...(initialTokens === undefined ? {} : { initialTokens }),
    }),
    {
      blobs: BASE_BLOBS,
      ...rest,
      contextSources: [...(rest.contextSources ?? []), AGENTS.ref, WORK_GOAL.ref, USER_REQUEST.ref],
      contextInputs: [...(rest.contextInputs ?? []), ...WORK_GOAL_INPUT],
    },
  );
}

function build(harness: Harness, overrides: Partial<BuildContextInput> = {}): BuildContextResult {
  return buildContext({ ...harness.input, ...overrides });
}

/** Builds and asserts success, surfacing the exact errors when it does not. */
function buildOk(
  harness: Harness,
  overrides: Partial<BuildContextInput> = {},
): Extract<BuildContextResult, { readonly ok: true }> {
  const result = build(harness, overrides);
  if (!result.ok)
    throw new Error(`expected a frozen snapshot, got ${JSON.stringify(result.errors)}`);
  return result;
}

/** A writer that records what it was asked to freeze without touching the disk. */
function memoryWriter(): SnapshotWriterPort & { readonly requests: string[] } {
  const requests: string[] = [];
  return {
    requests,
    write(request) {
      requests.push(request.snapshotRef);
      return { directory: `/memory/${request.snapshotRef}`, created: true };
    },
  };
}

const temporaryRoots: string[] = [];
afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('buildContext — happy path (AC-030)', () => {
  it('freezes the documented fields and copies the content into the snapshot directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'ctx-freeze-'));
    temporaryRoots.push(root);
    const harness = assistHarness({ writer: createSnapshotDirectoryWriter({ root }) });

    const result = buildOk(harness);
    const { snapshot } = result;

    expect(snapshot.snapshotRef).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(snapshot.policyHash).toBe(sha256(POLICY_BODY));
    expect(snapshot.configHash).toBe(CONFIG_HASH);
    expect(snapshot.readScopeDigest).toBe(
      readScopeDigest(scopeFor('chief', 'assist', PROJECT) as ReadScope),
    );
    expect(snapshot.selection.goal).toBe('实现 WP-05 context 层');
    expect(snapshot.excluded).toHaveLength(0);
    expect(snapshot.unknowns).toHaveLength(0);
    expect(snapshot.tokenAccounting).toEqual({
      initial: { limit: 24_000, used: result.usage.consumedTokens },
      expansion: { limit: 16_000, used: 0 },
    });

    const policy = snapshot.resolvedSources.find(
      (source) => source.path === 'docs/rules/agents.md',
    );
    expect(policy).toBeDefined();
    expect(policy?.hash).toBe(sha256(AGENTS_MD));
    expect(policy?.bytes).toBe(Buffer.byteLength(AGENTS_MD, 'utf8'));
    expect(policy?.revision).toBe('revision-1');
    expect(policy?.reason).toContain('选择');
    expect(policy?.ref).toEqual({
      kind: 'policy',
      id: 'docs/rules/agents.md',
      version: 'revision-1',
      path: 'docs/rules/agents.md',
    });

    const goal = snapshot.resolvedSources.find((source) => source.path === WORK_GOAL.ref.path);
    expect(goal?.hash).toBe(sha256(GOAL_MD));
    expect(goal?.bytes).toBe(Buffer.byteLength(GOAL_MD, 'utf8'));

    // The role contract is a fixed part of every package (`agents.md` §2).
    const contract = snapshot.resolvedSources.find((source) => source.id === ROLE_CONTRACT_ID);
    expect(contract?.hash).toBe(sha256(CONTRACT_BODY));

    // The actual bytes were copied, each named by its content hash.
    const files = readdirSync(result.directory);
    expect(files).toContain(sha256(AGENTS_MD));
    expect(files).toContain(sha256(USER_MESSAGE));
    expect(files).toContain('manifest.json');
    expect(readFileSync(join(result.directory, sha256(AGENTS_MD)), 'utf8')).toBe(AGENTS_MD);

    // The frozen identity is the digest of the payload, excluding the clock.
    const { snapshotRef, ...identity } = snapshot;
    expect(snapshotRef).toBe(contextSnapshotRef(identity));

    expect(result.usage.initialTokens).toBe(24_000);
    expect(result.usage.consumedTokens).toBeGreaterThan(0);
    expect(result.usage.remainingTokens).toBe(24_000 - result.usage.consumedTokens);
    expect(result.usage.dropped).toHaveLength(0);
    expect(result.directory).toBe(join(root, 'snapshots', 'context', snapshotRef));
  });

  it('accounts tokens with the documented character/4 estimator by default', () => {
    expect(characterTokenCounter('abcdefgh')).toBe(2);
    expect(characterTokenCounter('abc')).toBe(1);
    expect(characterTokenCounter('')).toBe(0);

    const harness = assistHarness({ tokenCounter: (content) => content.length });
    const result = buildOk(harness);
    const expected = AGENTS_MD.length + GOAL_MD.length + USER_MESSAGE.length + CONTRACT_BODY.length;
    expect(result.usage.consumedTokens).toBe(expected);
    expect(result.usage.remainingTokens).toBe(24_000 - expected);
  });

  it('resolves an artifact id@version through the fetch port', () => {
    const selection = selectionOf({
      sources: [AGENTS, WORK_GOAL, USER_REQUEST],
      artifactRefs: [artifactRef(ARTIFACT_PLAN, 1)],
      reasonPerSource: { [`artifact:${ARTIFACT_PLAN}`]: 'L1 CompactPlan，hash 已冻结' },
    });
    const port = makeHarness(selection, {
      role: 'chief',
      stage: 'assist',
      blobs: BASE_BLOBS,
      contextSources: [
        AGENTS.ref,
        WORK_GOAL.ref,
        USER_REQUEST.ref,
        { ...artifact(ARTIFACT_PLAN, 1, 'plan'), path: 'artifacts/plan/l1-compact.md' },
      ],
      contextInputs: WORK_GOAL_INPUT,
      artifacts: { [ARTIFACT_PLAN]: { version: 1, content: PLAN_BODY } },
    });
    const result = buildOk(port);
    // The artifact's content was read through the content port and frozen.
    expect(port.fetches).toContainEqual({ kind: 'artifact', id: ARTIFACT_PLAN, version: '1' });
    expect(result.snapshot.resolvedSources.some((source) => source.id === ARTIFACT_PLAN)).toBe(
      true,
    );
  });
});

describe('buildContext — selection validation (AC-030)', () => {
  it('rejects a selection entry without a reason and lists the offender', () => {
    const selection = selectionOf({
      sources: [WORK_GOAL],
      reasonPerSource: { [`git:${WORK_GOAL.ref.id}`]: undefined },
    });
    const port = makeHarness(selection, { blobs: BASE_BLOBS, contextSources: [WORK_GOAL.ref] });
    const result = build(port);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
    const offender = result.errors.find((error) => error.ref?.id === WORK_GOAL.ref.id);
    expect(offender?.message).toContain('reason');
    // Nothing was resolved or fetched: the selection itself is unusable.
    expect(port.resolutions).toHaveLength(0);
    expect(port.fetches).toHaveLength(0);
  });

  it('rejects a blank goal', () => {
    const result = build(makeHarness(selectionOf({ goal: '   ' }), { blobs: BASE_BLOBS }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.errors.some((error) => error.message.includes('goal'))).toBe(true);
  });

  it('rejects a budget ceiling that is not a non-negative integer', () => {
    const selection = selectionOf({ sources: [AGENTS] });
    const negative = {
      ...selection,
      readBudget: { initialTokens: -1, expansionTokens: 0 },
    };
    const result = build(
      makeHarness(negative, { blobs: BASE_BLOBS, contextSources: [AGENTS.ref] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.errors.some((error) => error.message.includes('initialTokens'))).toBe(true);
  });

  it('refuses a budget outside the documented 4096–2000000 range (AC-036)', () => {
    const selection = selectionOf({ sources: [AGENTS] });
    const rejected: readonly (readonly [string, ContextSelection['readBudget']])[] = [
      ['below the floor', { initialTokens: 4_095, expansionTokens: 16_000 }],
      ['above the ceiling', { initialTokens: 2_000_001, expansionTokens: 16_000 }],
      ['fractional', { initialTokens: 4_096.5, expansionTokens: 16_000 }],
      ['unbounded', { initialTokens: 1e15, expansionTokens: 16_000 }],
      ['max safe integer', { initialTokens: Number.MAX_SAFE_INTEGER, expansionTokens: 16_000 }],
      ['expansion above the ceiling', { initialTokens: 24_000, expansionTokens: 3_000_000 }],
    ];
    for (const [label, readBudget] of rejected) {
      const result = build(
        makeHarness(
          { ...selection, readBudget },
          { blobs: BASE_BLOBS, contextSources: [AGENTS.ref] },
        ),
      );
      expect(result.ok, label).toBe(false);
      if (result.ok) continue;
      expect(result.code, label).toBe('VALIDATION_ERROR');
    }
    // The documented boundaries themselves are accepted: the build then fails on
    // the missing required inputs, never on the budget.
    for (const initialTokens of [4_096, 2_000_000]) {
      const result = build(
        makeHarness(
          { ...selection, readBudget: { initialTokens, expansionTokens: 16_000 } },
          { blobs: BASE_BLOBS, contextSources: [AGENTS.ref] },
        ),
      );
      expect(result.ok, String(initialTokens)).toBe(false);
      if (!result.ok) {
        expect(result.errors.every((error) => error.code !== 'VALIDATION_ERROR')).toBe(true);
      }
    }
  });

  it('rejects an artifactRef without its own reason', () => {
    const selection = selectionOf({
      artifactRefs: [artifactRef(ARTIFACT_PLAN, 1)],
      reasonPerSource: { [`artifact:${ARTIFACT_PLAN}`]: undefined },
    });
    const result = build(
      makeHarness(selection, {
        blobs: BASE_BLOBS,
        contextSources: [
          { ...artifact(ARTIFACT_PLAN, 1, 'plan'), path: 'artifacts/plan/l1-compact.md' },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.errors.some((error) => error.message.includes(`artifact:${ARTIFACT_PLAN}`))).toBe(
      true,
    );
  });
});

describe('buildContext — ACL before resolution (AC-033, AC-034)', () => {
  it('refuses a transcript for a review Run without resolving or leaking its content', () => {
    const secret = 'DEVELOPER CHAT: the payment path is fine, skip the test.\n';
    const selection = selectionOf({
      sources: [AGENTS],
      reasonPerSource: { 'message:transcripts/dev-chat.md': '读取开发聊天' },
    });
    const port = makeHarness(selection, {
      role: 'review',
      stage: 'review',
      blobs: { ...BASE_BLOBS, 'transcripts/dev-chat.md@1': secret },
      contextSources: [
        AGENTS.ref,
        {
          kind: 'transcript',
          id: 'transcripts/dev-chat.md',
          version: '1',
          path: 'transcripts/dev-chat.md',
        },
      ],
    });
    const result = build(port);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONTEXT_FORBIDDEN');
    expect(result.errors).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('DEVELOPER CHAT');
    expect(port.resolutions.map((ref) => `${ref.kind}:${ref.id}`)).not.toContain(
      'transcript:transcripts/dev-chat.md',
    );
  });

  it('refuses a chat log by its path marker even when it is selected as a git source', () => {
    const selection = selectionOf({
      sources: [
        { ref: { kind: 'git', id: 'chat/dev-chat.md', version: '1', path: 'chat/dev-chat.md' } },
      ],
    });
    const port = makeHarness(selection, { role: 'review', stage: 'review', blobs: BASE_BLOBS });
    const result = build(port);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONTEXT_FORBIDDEN');
    expect(port.resolutions).toHaveLength(0);
  });

  it('refuses a handle that belongs to another Project (AC-034)', () => {
    const selection = selectionOf({
      sources: [AGENTS, USER_REQUEST],
      reasonPerSource: { 'git:src/orders.ts': 'A 项目的来源' },
    });
    const port = makeHarness(selection, {
      blobs: { ...BASE_BLOBS, 'src/orders.ts@revision-1': 'export const order = 1;\n' },
      contextSources: [
        AGENTS.ref,
        USER_REQUEST.ref,
        {
          kind: 'git',
          id: 'src/orders.ts',
          version: 'revision-1',
          path: 'src/orders.ts',
          projectId: OTHER_PROJECT_ID,
        },
      ],
    });
    const result = build(port);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONTEXT_FORBIDDEN');
    // No content of the other Project leaked into the failure.
    expect(JSON.stringify(result)).not.toContain('order = 1');
    expect(port.fetches).toHaveLength(0);
    expect(port.resolutions.every((ref) => ref.id !== 'src/orders.ts')).toBe(true);
  });

  it('keeps a foreign Artifact out of the frozen result', () => {
    const selection = selectionOf({
      sources: ASSIST_SOURCES,
      artifactRefs: [artifactRef(ARTIFACT_FOREIGN, 1)],
      reasonPerSource: { [`artifact:${ARTIFACT_FOREIGN}`]: 'A 项目的产物' },
    });
    // The artifact does not exist in this Project, so the resolver can only answer
    // NOT_FOUND; it is recorded as an unknown and never injected.
    const result = buildOk(
      makeHarness(selection, {
        blobs: BASE_BLOBS,
        contextSources: [
          AGENTS.ref,
          WORK_GOAL.ref,
          USER_REQUEST.ref,
          artifact(ARTIFACT_FOREIGN, 1, 'plan'),
        ],
        contextInputs: WORK_GOAL_INPUT,
      }),
    );
    expect(result.snapshot.resolvedSources.some((source) => source.id === ARTIFACT_FOREIGN)).toBe(
      false,
    );
    const unknown = result.snapshot.unknowns.find((entry) => entry.ref.id === ARTIFACT_FOREIGN);
    expect(unknown).toBeDefined();
    expect(unknown?.reason).toContain('不存在');
  });
});

describe('buildContext — the selection is the authority over its overlay (AC-030)', () => {
  it('refuses an overlay that rewrites the declared path/version and freezes nothing', () => {
    const writer = memoryWriter();
    const port = makeHarness(selectionOf({ sources: [AGENTS, WORK_GOAL, USER_REQUEST] }), {
      blobs: { ...BASE_BLOBS, 'docs/OTHER.md@revision-2': '# REVISION TWO BODY\n' },
      writer,
      // The overlay points the same `policy:docs/rules/agents.md` handle at another
      // revision and another file. The selection is Chief's declaration, so this
      // must be refused instead of freezing revision-2/docs/OTHER.md.
      contextSources: [
        { kind: 'policy', id: AGENTS.ref.id, version: 'revision-2', path: 'docs/OTHER.md' },
        WORK_GOAL.ref,
        USER_REQUEST.ref,
      ],
      contextInputs: WORK_GOAL_INPUT,
    });
    const result = build(port);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.errors.some((error) => error.message.includes('不一致'))).toBe(true);
    // Nothing was resolved, nothing was frozen, and the other revision's bytes
    // never entered the result.
    expect(port.resolutions).toHaveLength(0);
    expect(writer.requests).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain('REVISION TWO');
  });

  it('keeps the declared revision and path when the overlay only adds metadata', () => {
    // A `SourceRef` cannot carry a message sender or an artifact class, so the
    // overlay is the only place that information can come from — but it may not
    // replace the identity the selection declared.
    const handle: SelectedSource = {
      ref: {
        kind: 'policy',
        id: 'rules:agents',
        version: 'revision-1',
        path: 'docs/rules/agents.md',
      },
    };
    const selection = selectionOf({ sources: [handle, WORK_GOAL, USER_REQUEST] });
    const result = buildOk(
      makeHarness(selection, {
        blobs: BASE_BLOBS,
        // The overlay deliberately omits the path: an overlay that "won" would
        // lose it and resolve the wrong blob.
        contextSources: [
          { kind: 'policy', id: 'rules:agents', version: 'revision-1' },
          WORK_GOAL.ref,
          USER_REQUEST.ref,
        ],
        contextInputs: WORK_GOAL_INPUT,
      }),
    );
    const resolved = result.snapshot.resolvedSources.find((source) => source.id === 'rules:agents');
    expect(resolved?.path).toBe('docs/rules/agents.md');
    expect(resolved?.revision).toBe('revision-1');
    expect(resolved?.ref).toEqual({
      kind: 'policy',
      id: 'rules:agents',
      version: 'revision-1',
      path: 'docs/rules/agents.md',
    });
    expect(result.snapshot.selection.sourceRefs).toContainEqual({
      kind: 'policy',
      id: 'rules:agents',
      version: 'revision-1',
      path: 'docs/rules/agents.md',
    });
  });

  it('refuses an artifact overlay that names another version', () => {
    const selection = selectionOf({
      sources: [AGENTS, WORK_GOAL, USER_REQUEST],
      artifactRefs: [artifactRef(ARTIFACT_PLAN, 1)],
      reasonPerSource: { [`artifact:${ARTIFACT_PLAN}`]: 'L1 CompactPlan，版本已冻结' },
    });
    const port = makeHarness(selection, {
      blobs: BASE_BLOBS,
      artifacts: { [ARTIFACT_PLAN]: { version: 1, content: PLAN_BODY } },
      contextSources: [
        AGENTS.ref,
        WORK_GOAL.ref,
        USER_REQUEST.ref,
        artifact(ARTIFACT_PLAN, 2, 'plan'),
      ],
      contextInputs: WORK_GOAL_INPUT,
    });
    const result = build(port);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(port.fetches).toHaveLength(0);
  });
});

describe('buildContext — required inputs (AC-031, AC-079)', () => {
  it('returns MISSING_CONTEXT with the precise gap and no frozen snapshot', () => {
    const selection = selectionOf({ sources: [AGENTS] });
    const writer = memoryWriter();
    const port = makeHarness(selection, {
      blobs: BASE_BLOBS,
      writer,
      contextSources: [AGENTS.ref],
    });
    const result = build(port);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('MISSING_CONTEXT');
    const inputs = result.errors.map((error) => (error as { input?: string }).input);
    expect(inputs).toContain('userRequest');
    expect(inputs).toContain('workGoal');
    // Fail closed: a rejected build never freezes a snapshot.
    expect(writer.requests).toHaveLength(0);
  });

  it('does not expand a module to satisfy a gap', () => {
    const port = makeHarness(selectionOf({ sources: [AGENTS] }), {
      blobs: baseBlobsWithNeighbour(),
      contextSources: [AGENTS.ref],
    });
    // The policy file resolves and is fetched; no other source is touched.
    const result = build(port);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('MISSING_CONTEXT');
    // Only the selected policy file was ever resolved: the neighbouring module was
    // never expanded to close the gap.
    expect(port.resolutions.map((ref) => ref.id)).toEqual(['docs/rules/agents.md']);
    expect(port.fetches).toHaveLength(0);
  });

  it('starts initialize in an empty Project with a BootstrapObservation (AC-079 #1)', () => {
    const port = makeHarness(selectionOf({ sources: [AGENTS, WORK_GOAL, USER_REQUEST] }), {
      role: 'chief',
      stage: 'initialize',
      blobs: BASE_BLOBS,
      contextSources: [AGENTS.ref, WORK_GOAL.ref, USER_REQUEST.ref],
      contextInputs: ['bootstrapObservation', 'workGoal'],
    });
    const result = buildOk(port);
    expect(result.snapshot.resolvedSources.length).toBeGreaterThan(0);
  });

  it('starts initialize with a Project overview instead (AC-079 #1 alt)', () => {
    const port = makeHarness(selectionOf({ sources: [AGENTS, WORK_GOAL, USER_REQUEST, INDEX] }), {
      role: 'chief',
      stage: 'initialize',
      blobs: BASE_BLOBS,
      contextSources: [AGENTS.ref, WORK_GOAL.ref, USER_REQUEST.ref, INDEX.ref],
      contextInputs: ['projectOverview', 'workGoal'],
    });
    buildOk(port);
  });

  it('starts a Product stage with an overview and a confirmed source (AC-079 #2)', () => {
    const selection = selectionOf({
      sources: [AGENTS, INDEX, WORK_GOAL, USER_REQUEST],
    });
    const port = makeHarness(selection, {
      role: 'product',
      stage: 'product',
      blobs: BASE_BLOBS,
      contextSources: [AGENTS.ref, INDEX.ref, WORK_GOAL.ref, USER_REQUEST.ref],
      contextInputs: ['projectOverview', 'currentFacts', 'confirmedSource', 'workGoal'],
    });
    buildOk(port);
  });

  it('starts Planning with only a ProductDefinition and acceptance (AC-079 #3)', () => {
    const selection = selectionOf({
      sources: [AGENTS, USER_REQUEST],
      artifactRefs: [artifactRef(ARTIFACT_PRODUCT, 1)],
      reasonPerSource: { [`artifact:${ARTIFACT_PRODUCT}`]: '有效 ProductDefinition' },
    });
    const port = makeHarness(selection, {
      role: 'planning',
      stage: 'planning',
      blobs: BASE_BLOBS,
      contextSources: [AGENTS.ref, USER_REQUEST.ref, artifact(ARTIFACT_PRODUCT, 1, 'product')],
      contextInputs: ['acceptance'],
      artifacts: { [ARTIFACT_PRODUCT]: { version: 1, content: DESIGN_BODY } },
    });
    const result = buildOk(port);
    expect(result.snapshot.resolvedSources.some((source) => source.id === ARTIFACT_PRODUCT)).toBe(
      true,
    );
  });

  it('starts L1 Develop with only a CompactPlan (AC-079 #4)', () => {
    const selection = selectionOf({
      sources: [AGENTS, WORK_GOAL, USER_REQUEST, CURRENT_FILE],
      artifactRefs: [artifactRef(ARTIFACT_PLAN, 1)],
      reasonPerSource: { [`artifact:${ARTIFACT_PLAN}`]: 'L1 CompactPlan（plan 类产物）' },
    });
    const port = makeHarness(selection, {
      role: 'backend',
      stage: 'develop-L1',
      blobs: BASE_BLOBS,
      contextSources: [
        AGENTS.ref,
        WORK_GOAL.ref,
        USER_REQUEST.ref,
        CURRENT_FILE.ref,
        {
          ...artifact(ARTIFACT_PLAN, 1, 'plan'),
          path: 'artifacts/plan/l1-compact.md',
        },
      ],
      contextInputs: ['replacementTarget', 'workGoal', 'currentFiles'],
      artifacts: { [ARTIFACT_PLAN]: { version: 1, content: PLAN_BODY } },
    });
    const result = buildOk(port);
    expect(result.snapshot.resolvedSources.some((source) => source.id === ARTIFACT_PLAN)).toBe(
      true,
    );
    // The full `Plan` is a future product and was never demanded.
    expect(
      result.snapshot.resolvedSources.some(
        (source) => source.reason === 'L1 CompactPlan（plan 类产物）',
      ),
    ).toBe(true);
  });
});

describe('buildContext — budget (AC-036)', () => {
  it('reports BUDGET_EXCEEDED with the dropped ref and the missing tokens', () => {
    // The tiny policy file (1 token) fits, then the oversized user message (5000
    // tokens) does not; `userRequest` is a hard requirement of `chief:assist`, so
    // the gap must be reported as a budget gap rather than as a missing selection
    // (`AC-036`). The ceiling is the documented minimum (4096), so the body — not
    // the budget — is what makes the drop real.
    const largeMessage = 'u'.repeat(20_000);
    const selection = selectionOf({
      sources: [TINY_POLICY, USER_REQUEST],
      initialTokens: 4_096,
    });
    const port = makeHarness(selection, {
      blobs: {
        ...BASE_BLOBS,
        [`${TINY_POLICY.ref.path}@revision-1`]: TINY_POLICY_BODY,
        [`${USER_REQUEST.ref.id}@1`]: largeMessage,
      },
      contextSources: [TINY_POLICY.ref, USER_REQUEST.ref],
      contextInputs: WORK_GOAL_INPUT,
    });
    const result = build(port);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('BUDGET_EXCEEDED');
    const first = result.errors[0];
    expect(first?.code).toBe('BUDGET_EXCEEDED');
    expect((first as { readonly input?: string }).input).toBe('userRequest');
    expect(first?.message).toMatch(/缺口 \d+ tokens/);
    // The user message is the only source over the ceiling; the role contract
    // still fits, and its requirement is already satisfied by the policy file.
    expect(result.usage?.dropped.map((entry) => entry.ref.id)).toEqual([USER_REQUEST.ref.id]);
    const dropped = result.usage?.dropped[0];
    expect(dropped?.tokens).toBe(tokensOf(largeMessage));
    expect(dropped?.shortfall).toBe(tokensOf(TINY_POLICY_BODY) + tokensOf(largeMessage) - 4_096);
    expect(result.usage?.consumedTokens).toBe(tokensOf(TINY_POLICY_BODY) + tokensOf(CONTRACT_BODY));
    // Only the sources before the overflow were resolved; nothing was scanned.
    expect(port.resolutions.map((ref) => ref.id)).toEqual([
      TINY_POLICY.ref.id,
      USER_REQUEST.ref.id,
    ]);
  });

  it('drops an optional source instead of the whole package and names it', () => {
    const selection = selectionOf({
      sources: [AGENTS, WORK_GOAL, USER_REQUEST, DUMP],
      initialTokens: 4_096,
    });
    const result = buildOk(
      makeHarness(selection, {
        blobs: BASE_BLOBS,
        contextSources: [AGENTS.ref, WORK_GOAL.ref, USER_REQUEST.ref, DUMP.ref],
        contextInputs: WORK_GOAL_INPUT,
      }),
    );
    expect(result.usage.dropped).toHaveLength(1);
    const dropped = result.usage.dropped[0];
    expect(dropped?.ref.id).toBe(DUMP.ref.id);
    expect(result.snapshot.excluded.some((entry) => entry.ref.id === DUMP.ref.id)).toBe(true);
    expect(result.snapshot.unknowns.some((entry) => entry.ref.id === DUMP.ref.id)).toBe(true);
    expect(result.usage.consumedTokens).toBeLessThanOrEqual(4_096);
    expect(
      result.snapshot.resolvedSources.some((source) => source.path === WORK_GOAL.ref.path),
    ).toBe(true);
  });

  it('reports an artifact whose version moved on as STALE_ARTIFACT', () => {
    const selection = selectionOf({
      sources: [AGENTS, USER_REQUEST],
      artifactRefs: [artifactRef(ARTIFACT_PRODUCT, 1)],
      reasonPerSource: { [`artifact:${ARTIFACT_PRODUCT}`]: 'ProductDefinition' },
    });
    const port = makeHarness(selection, {
      role: 'planning',
      stage: 'planning',
      blobs: BASE_BLOBS,
      contextSources: [AGENTS.ref, USER_REQUEST.ref, artifact(ARTIFACT_PRODUCT, 1, 'product')],
      artifacts: { [ARTIFACT_PRODUCT]: { version: 2, content: DESIGN_BODY } },
    });
    const result = build(port);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('STALE_ARTIFACT');
  });
});

describe('buildContext — snapshot immutability and idempotence', () => {
  it('leaves a frozen snapshot unchanged after the source file is edited', () => {
    const root = mkdtempSync(join(tmpdir(), 'ctx-real-'));
    temporaryRoots.push(root);
    const sourcePath = join(root, 'goal.md');
    writeFileSync(sourcePath, GOAL_MD, 'utf8');

    // A Git revision pins its blob: the first resolution records the hash and
    // keeps it even after the file is edited, while the fetch reads the file.
    const pinned = new Map<string, Hash>();
    const base = assistHarness({ writer: createSnapshotDirectoryWriter({ root }) });
    const realInput: BuildContextInput = {
      ...base.input,
      resolver: {
        resolve({ ref }) {
          const goalPath = WORK_GOAL.ref.path ?? '.agentdev/work/WP-05/goal.md';
          if (ref.path === goalPath) {
            const content = readFileSync(sourcePath, 'utf8');
            const hash = pinned.get('goal') ?? sha256(content);
            pinned.set('goal', hash);
            return {
              ok: true,
              hash,
              kind: 'git',
              path: goalPath,
              revision: ref.version,
              fetch: { kind: 'git', revision: ref.version },
              fetchRef: { kind: 'git', path: goalPath, revision: ref.version },
            };
          }
          if (ref.kind === 'role_contract' || ref.kind === 'policy') {
            const path = ref.path ?? ref.id;
            const blob = path === 'docs/rules/agents.md' ? AGENTS_MD : undefined;
            if (blob === undefined) {
              return { ok: false, code: 'NOT_FOUND', message: `${path} 不存在` };
            }
            return {
              ok: true,
              hash: sha256(blob),
              kind: ref.kind === 'role_contract' ? 'role_contract' : 'git',
              path,
              revision: ref.version,
              fetch: { kind: 'none' },
              content: blob,
            };
          }
          if (ref.kind === 'message') {
            return {
              ok: true,
              hash: sha256(USER_MESSAGE),
              kind: 'git',
              revision: ref.version,
              fetch: { kind: 'none' },
              content: USER_MESSAGE,
            };
          }
          return { ok: false, code: 'NOT_FOUND', message: `${ref.id} 不存在` };
        },
      },
      content: {
        fetch(ref) {
          if (ref.kind === 'artifact') {
            return { ok: false, code: 'NOT_FOUND', message: 'no artifact' };
          }
          // The fetch always reads the *current* file, so an edit is visible here
          // but must never change an already frozen snapshot.
          return { ok: true, content: readFileSync(sourcePath, 'utf8') };
        },
      },
    };

    const first = buildContext(realInput);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const frozenHash = first.snapshot.resolvedSources.find(
      (source) => source.path === WORK_GOAL.ref.path,
    )?.hash;
    expect(frozenHash).toBe(sha256(GOAL_MD));
    expect(readFileSync(join(first.directory, sha256(GOAL_MD)), 'utf8')).toBe(GOAL_MD);

    writeFileSync(sourcePath, '# WP-05 goal\n\nEDITED after the snapshot.\n', 'utf8');

    // The pinned revision still declares the original hash, so a rebuild sees the
    // edited bytes and refuses instead of silently re-freezing them.
    const second = buildContext(realInput);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('STALE_ARTIFACT');

    // The already frozen directory and its content are untouched.
    expect(readFileSync(join(first.directory, sha256(GOAL_MD)), 'utf8')).toBe(GOAL_MD);
    expect(first.directory).toBe(join(root, 'snapshots', 'context', first.snapshot.snapshotRef));
  });

  it('re-freezes identical inputs idempotently', () => {
    const root = mkdtempSync(join(tmpdir(), 'ctx-idem-'));
    temporaryRoots.push(root);
    const writer = createSnapshotDirectoryWriter({ root });
    const harness = assistHarness({ writer });
    const first = buildOk(harness, { now: () => '2026-09-11T00:00:00.000Z' });
    const second = buildOk(harness, { now: () => '2026-09-12T00:00:00.000Z' });
    expect(second.snapshot.snapshotRef).toBe(first.snapshot.snapshotRef);
    expect(second.directory).toBe(first.directory);
    expect(second.usage).toEqual(first.usage);
    const files = readdirSync(first.directory);
    expect(files.filter((name) => name.includes('.tmp'))).toHaveLength(0);
    expect(new Set(files).size).toBe(files.length);
    const manifest = JSON.parse(readFileSync(join(first.directory, 'manifest.json'), 'utf8')) as {
      readonly snapshotRef: string;
    };
    expect(manifest.snapshotRef).toBe(first.snapshot.snapshotRef);
    // The exported identity payload is what `SnapshotWriter.freeze` must hash to
    // reproduce this `snapshotRef` (the snapshot row is keyed by `(type, hash)`).
    expect(sha256(canonicalJson(snapshotIdentityPayload(first.snapshot)))).toBe(
      first.snapshot.snapshotRef,
    );
  });

  it('leaves the frozen directory byte-identical when re-frozen under a different clock', () => {
    const root = mkdtempSync(join(tmpdir(), 'ctx-immutable-'));
    temporaryRoots.push(root);
    const writer = createSnapshotDirectoryWriter({ root });
    const harness = assistHarness({ writer });
    const readDirectory = (directory: string): Record<string, string> =>
      Object.fromEntries(
        readdirSync(directory)
          .sort()
          .map((name) => [name, readFileSync(join(directory, name), 'utf8')]),
      );

    const first = buildOk(harness, { now: () => '2026-09-11T00:00:00.000Z' });
    const before = readDirectory(first.directory);
    const second = buildOk(harness, { now: () => '2027-01-01T00:00:00.000Z' });

    // The identity ignores the clock and the directory is immutable: a re-freeze
    // must not rewrite `manifest.json` with a new `createdAt` (W5R1-12).
    expect(second.directory).toBe(first.directory);
    expect(second.snapshot.snapshotRef).toBe(first.snapshot.snapshotRef);
    expect(readDirectory(second.directory)).toEqual(before);
    const manifest = JSON.parse(before['manifest.json'] ?? '{}') as { readonly createdAt?: string };
    expect(manifest.createdAt).toBe('2026-09-11T00:00:00.000Z');
    // `createdAt` is still part of the in-memory snapshot: it records when *this*
    // build ran, while the frozen directory keeps the first freeze's stamp.
    expect(second.snapshot.createdAt).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('buildContext — excluded and unknown refs (AC-093)', () => {
  it('records a reference that does not exist and never expands it', () => {
    const selection = selectionOf({
      sources: [AGENTS, WORK_GOAL, USER_REQUEST, MISSING],
      reasonPerSource: { 'git:src/missing.ts': '直接关联的调用方' },
    });
    const port = makeHarness(selection, {
      blobs: BASE_BLOBS,
      contextSources: [AGENTS.ref, WORK_GOAL.ref, USER_REQUEST.ref, MISSING.ref],
      contextInputs: WORK_GOAL_INPUT,
    });
    const result = buildOk(port);
    expect(result.snapshot.resolvedSources.some((source) => source.path === MISSING.ref.path)).toBe(
      false,
    );
    const unknown = result.snapshot.unknowns.find((entry) => entry.ref.id === MISSING.ref.id);
    expect(unknown).toBeDefined();
    expect(unknown?.reason).toContain('不存在');
    // The neighbouring file was never resolved or fetched: no module expansion.
    expect(port.resolutions.some((ref) => ref.id === 'src/orders/cancel.ts')).toBe(false);
    expect(
      port.fetches.some((fetch) => fetch.kind === 'git' && fetch.path === 'src/orders/cancel.ts'),
    ).toBe(false);
  });

  it('keeps the selection’s own excluded and unknowns verbatim', () => {
    const selection = selectionOf({
      sources: [AGENTS, WORK_GOAL, USER_REQUEST],
      excluded: ['payment module: out of scope'],
      unknowns: ['plugin registry shape'],
    });
    const result = buildOk(
      makeHarness(selection, {
        blobs: BASE_BLOBS,
        contextSources: [AGENTS.ref, WORK_GOAL.ref, USER_REQUEST.ref],
        contextInputs: WORK_GOAL_INPUT,
      }),
    );
    expect(
      result.snapshot.excluded.some((entry) => entry.reason === 'payment module: out of scope'),
    ).toBe(true);
    expect(result.snapshot.unknowns.some((entry) => entry.reason === 'plugin registry shape')).toBe(
      true,
    );
  });
});

describe('buildContext — failure closure', () => {
  it('rejects an illegal role/stage pair without freezing anything', () => {
    const result = build(assistHarness({ role: 'review', stage: 'assist' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unknown stage spelling', () => {
    const result = build(assistHarness({ stage: 'not-a-stage' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('reports a snapshot-writer failure as INTERNAL_ERROR with no partial result', () => {
    const failing: SnapshotWriterPort = {
      write() {
        throw new Error('disk full');
      },
    };
    const result = build(assistHarness({ writer: failing }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INTERNAL_ERROR');
    // A port failure is closed and never leaks the raw port message (W5R1-10).
    expect(JSON.stringify(result)).not.toContain('disk full');
  });

  it('closes a throwing resolver, content or gates port without freezing anything', () => {
    const writer = memoryWriter();
    const assistBase = assistHarness({ writer });
    // The assistant route resolves its content inline, so the *content* port is
    // only reached through an artifact fetch: give that case its own harness.
    const artifactBase = makeHarness(
      selectionOf({
        sources: [AGENTS, WORK_GOAL, USER_REQUEST],
        artifactRefs: [artifactRef(ARTIFACT_PLAN, 1)],
        reasonPerSource: { [`artifact:${ARTIFACT_PLAN}`]: 'L1 CompactPlan' },
      }),
      {
        blobs: BASE_BLOBS,
        writer,
        contextSources: [
          AGENTS.ref,
          WORK_GOAL.ref,
          USER_REQUEST.ref,
          artifact(ARTIFACT_PLAN, 1, 'plan'),
        ],
        contextInputs: WORK_GOAL_INPUT,
        artifacts: { [ARTIFACT_PLAN]: { version: 1, content: PLAN_BODY } },
      },
    );
    const throwingPorts: readonly {
      readonly name: string;
      readonly base: Harness;
      readonly overrides: Partial<BuildContextInput>;
    }[] = [
      {
        name: 'resolver',
        base: assistBase,
        overrides: {
          resolver: {
            resolve() {
              throw new Error('resolver exploded: secret-token');
            },
          },
        },
      },
      {
        name: 'content',
        base: artifactBase,
        overrides: {
          content: {
            fetch() {
              throw new Error('fetch exploded: secret-token');
            },
          },
        },
      },
      {
        name: 'gates',
        base: assistBase,
        overrides: {
          gates: {
            current() {
              throw new Error('gates exploded: secret-token');
            },
          },
        },
      },
    ];
    for (const port of throwingPorts) {
      const result = build(port.base, port.overrides);
      expect(result.ok, port.name).toBe(false);
      if (result.ok) continue;
      expect(result.code, port.name).toBe('INTERNAL_ERROR');
      const serialized = JSON.stringify(result);
      expect(serialized, port.name).not.toContain('secret-token');
      expect(serialized, port.name).not.toContain('exploded');
    }
    // No failure path reached the writer: a closed failure leaves no snapshot.
    expect(writer.requests).toHaveLength(0);
  });
});

/** The frozen shape the builder promises, kept exercised by the type checker. */
export type ContextBuilderTestSurface = {
  readonly snapshot: ContextSnapshot;
  readonly role: BuildContextInput['role'];
  readonly fetches: readonly FetchRef[];
};
