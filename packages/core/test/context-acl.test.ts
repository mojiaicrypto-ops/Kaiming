/**
 * The role/stage ACL (`docs/architecture/context.md` §1/§5,
 * `docs/architecture/execution.md` §3, `docs/rules/agents.md` §1/§2).
 *
 * Every assertion here stands for a documented refusal or grant: the
 * readable/denied kind matrix, Transcript isolation by kind *and* by path marker
 * (`AC-033`), cross-Project isolation (`AC-034`), another Run's Session/Checkpoint,
 * and the future-artifact refusal that keeps `AC-079`'s stages unblocked.
 */
import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_ROOT,
  CONTEXT_ROLES,
  CONTEXT_STAGES,
  ROLE_ARTIFACT_CLASSES,
  ROLE_MESSAGE_CLASSES,
  ROLE_STAGES,
  SOURCE_KINDS,
  aclRuleFor,
  artifactClassFromPath,
  canRead,
  classifyMessageSender,
  explainDenial,
  fromSourceRefKind,
  isDeniedSourcePath,
  readableSourceKinds,
  roleStagePairs,
  scopeFor,
  toSourceRefKind,
  type ArtifactClass,
  type ContextRole,
  type ContextSourceRef,
  type ContextStage,
  type ProjectScope,
} from '../src/context/index.js';

const PROJECT: ProjectScope = {
  projectId: '11111111111111111111111111111111',
  codeRoot: 'src',
  documentRoot: 'docs',
  deliveryBranch: 'agentdev/main',
  workId: '0191f000-0000-7000-8000-000000000001',
};

const HASH = 'a'.repeat(64);

/** A legal reader for a role whose rules are keyed by `(role, stage)`. */
function stageOf(role: ContextRole): ContextStage {
  return ROLE_STAGES[role][0] as ContextStage;
}

function gitSource(path: string, overrides: Partial<ContextSourceRef> = {}): ContextSourceRef {
  return { kind: 'git', id: path, version: 'revision-1', path, ...overrides };
}

function messageSource(overrides: Partial<ContextSourceRef> = {}): ContextSourceRef {
  return {
    kind: 'message',
    id: 'message-user-1',
    version: '1',
    sender: 'user',
    ...overrides,
  };
}

function artifactSource(
  artifactClass: ArtifactClass,
  overrides: Partial<ContextSourceRef> = {},
): ContextSourceRef {
  const path = `${ARTIFACT_ROOT}/${artifactClass}/abcd`;
  return {
    kind: 'artifact',
    id: '0191f000-0000-7000-8000-0000000000aa',
    version: '1',
    path,
    artifactClass,
    hash: HASH,
    ...overrides,
  };
}

describe('context ACL — matrix completeness', () => {
  it('defines a rule row for every legal role/stage pair', () => {
    const pairs = roleStagePairs();
    expect(pairs.length).toBeGreaterThan(0);
    for (const [role, stage] of pairs) {
      const rule = aclRuleFor(role, stage);
      expect(rule, `${role}:${stage}`).toBeDefined();
      expect(rule?.role).toBe(role);
      expect(rule?.stage).toBe(stage);
      expect(rule?.required.length).toBeGreaterThan(0);
    }
  });

  it('only exposes stages of the documented vocabulary', () => {
    for (const [, stage] of roleStagePairs()) {
      expect(CONTEXT_STAGES).toContain(stage);
    }
    for (const stage of ROLE_STAGES.review) expect(CONTEXT_STAGES).toContain(stage);
  });

  it('has no rule for a pair the role may never run', () => {
    expect(aclRuleFor('review', 'develop-L2')).toBeUndefined();
    expect(aclRuleFor('test', 'review')).toBeUndefined();
    expect(aclRuleFor('settlement', 'product')).toBeUndefined();
    expect(readableSourceKinds('test', 'develop-L1')).toBeNull();
    expect(scopeFor('test', 'develop-L1', PROJECT)).toBeNull();
  });

  it('never grants a source class outside the documented matrix', () => {
    const transcript = SOURCE_KINDS.filter((kind) => kind === 'transcript');
    expect(transcript).toHaveLength(1);
    for (const [role, stage] of roleStagePairs()) {
      const scope = scopeFor(role, stage, PROJECT);
      expect(scope, `${role}:${stage}`).not.toBeNull();
      expect(scope?.sourceKinds).not.toContain('transcript');
      expect(scope?.denied.some((entry) => entry.kind === 'transcript')).toBe(true);
    }
  });

  it('mirrors every stage denial into a denied entry with a reason', () => {
    for (const [role, stage] of roleStagePairs()) {
      const scope = scopeFor(role, stage, PROJECT);
      expect(scope, `${role}:${stage}`).not.toBeNull();
      for (const entry of scope?.denied ?? []) {
        expect(entry.reason.length, `${role}:${stage}:${entry.kind}`).toBeGreaterThan(0);
      }
      for (const entry of scope?.deniedPaths ?? []) {
        expect(entry.reason.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('context ACL — readable kinds per role', () => {
  it('lets Chief read the documented classes', () => {
    const scope = scopeFor('chief', 'assist', PROJECT);
    expect(scope).not.toBeNull();
    if (scope === null) return;
    // agents.md §2 选择顺序: overview → work/requirement/task → feature navigation
    // → constraints → role-needed documents/code.
    expect(canRead('chief', 'assist', gitSource('docs/INDEX.md'), scope).allowed).toBe(true);
    expect(canRead('chief', 'assist', gitSource('docs/product/vision.md'), scope).allowed).toBe(
      true,
    );
    expect(canRead('chief', 'assist', gitSource('src/orders/cancel.ts'), scope).allowed).toBe(true);
    expect(
      canRead('chief', 'assist', gitSource('features/F-a1b2c3d4/README.md'), scope).allowed,
    ).toBe(true);
    expect(
      canRead('chief', 'assist', { kind: 'policy', id: 'policy-rev-1', version: '1' }, scope)
        .allowed,
    ).toBe(true);
    expect(
      canRead(
        'chief',
        'assist',
        { kind: 'role_contract', id: 'docs/rules/agents.md', version: '1' },
        scope,
      ).allowed,
    ).toBe(true);
    expect(canRead('chief', 'assist', messageSource(), scope).allowed).toBe(true);
    expect(
      canRead('chief', 'assist', artifactSource('settlement'), scope).allowed,
      'Chief reads every role result as a structured Artifact',
    ).toBe(true);
  });

  it('lets Review read frozen code, product/Plan/acceptance and evidence', () => {
    const scope = scopeFor('review', 'review', PROJECT);
    expect(scope).not.toBeNull();
    if (scope === null) return;
    expect(canRead('review', 'review', gitSource('src/orders/cancel.ts'), scope).allowed).toBe(
      true,
    );
    expect(canRead('review', 'review', gitSource('docs/product/orders.md'), scope).allowed).toBe(
      true,
    );
    expect(canRead('review', 'review', artifactSource('product'), scope).allowed).toBe(true);
    expect(canRead('review', 'review', artifactSource('plan'), scope).allowed).toBe(true);
    expect(canRead('review', 'review', artifactSource('diff'), scope).allowed).toBe(true);
    expect(canRead('review', 'review', artifactSource('evidence'), scope).allowed).toBe(true);
  });

  it('lets Test read frozen source, Review, acceptance and environment evidence', () => {
    const scope = scopeFor('test', 'test', PROJECT);
    expect(scope).not.toBeNull();
    if (scope === null) return;
    expect(canRead('test', 'test', gitSource('src/payments/charge.ts'), scope).allowed).toBe(true);
    expect(canRead('test', 'test', artifactSource('review'), scope).allowed).toBe(true);
    expect(canRead('test', 'test', artifactSource('test'), scope).allowed).toBe(true);
    expect(canRead('test', 'test', artifactSource('evidence'), scope).allowed).toBe(true);
  });

  it('lets Chief read a source of the current Project', () => {
    const scope = scopeFor('chief', 'assist', PROJECT);
    if (scope === null) throw new Error('chief must have a scope');
    expect(
      canRead(
        'chief',
        'assist',
        artifactSource('settlement', { projectId: PROJECT.projectId }),
        scope,
      ).allowed,
    ).toBe(true);
  });

  it('lets a Developer read its Task source and selected documents', () => {
    for (const role of ['backend', 'frontend'] as const) {
      const scope = scopeFor(role, 'develop-L2', PROJECT);
      expect(scope, role).not.toBeNull();
      if (scope === null) continue;
      expect(canRead(role, 'develop-L2', gitSource('src/orders/cancel.ts'), scope).allowed).toBe(
        true,
      );
      expect(canRead(role, 'develop-L2', gitSource('docs/product/orders.md'), scope).allowed).toBe(
        true,
      );
      expect(canRead(role, 'develop-L2', artifactSource('plan'), scope).allowed).toBe(true);
    }
  });

  it('keeps every role on its own write prefixes', () => {
    for (const [role, stage] of roleStagePairs()) {
      const scope = scopeFor(role, stage, PROJECT);
      expect(scope, `${role}:${stage}`).not.toBeNull();
      if (scope === null) continue;
      expect(scope.writePaths.length).toBeGreaterThan(0);
      for (const writePath of scope.writePaths) {
        expect(writePath.startsWith(`${ARTIFACT_ROOT}/`)).toBe(true);
      }
    }
    const backend = scopeFor('backend', 'develop-L2', PROJECT);
    const review = scopeFor('review', 'review', PROJECT);
    expect(backend?.writePaths).toContain(`${ARTIFACT_ROOT}/diff`);
    expect(backend?.writePaths).not.toContain(`${ARTIFACT_ROOT}/review`);
    expect(review?.writePaths).toContain(`${ARTIFACT_ROOT}/review`);
    expect(review?.writePaths).not.toContain(`${ARTIFACT_ROOT}/diff`);
  });
});

describe('context ACL — transcript isolation (AC-033)', () => {
  it('denies the transcript kind to every role and stage', () => {
    for (const [role, stage] of roleStagePairs()) {
      const scope = scopeFor(role, stage, PROJECT);
      if (scope === null) continue;
      const decision = canRead(
        role,
        stage,
        { kind: 'transcript', id: 'conversation-1', version: '1' },
        scope,
      );
      expect(decision.allowed, `${role}:${stage}`).toBe(false);
      if (!decision.allowed) expect(decision.code).toBe('CONTEXT_FORBIDDEN');
    }
  });

  it('denies Review and Test every message body', () => {
    for (const role of ['review', 'test'] as const) {
      const stage = stageOf(role);
      const scope = scopeFor(role, stage, PROJECT);
      if (scope === null) throw new Error('review/test must have a scope');
      expect(ROLE_MESSAGE_CLASSES[role]).toEqual([]);
      for (const sender of ['user', 'chief', 'role', 'system'] as const) {
        const decision = canRead(
          role,
          stage,
          {
            kind: 'message',
            id: '0191f000-0000-7000-8000-0000000000bb',
            version: '1',
            sender,
          },
          scope,
        );
        expect(decision.allowed, `${role}/${sender}`).toBe(false);
        if (!decision.allowed) expect(decision.code).toBe('CONTEXT_FORBIDDEN');
      }
    }
  });

  it('denies a chat/transcript path marker to every role by path', () => {
    const deniedPaths = [
      '.agentdev/work/WP-05/chat.log',
      '.agentdev/work/WP-05/chat-2026-01-01.md',
      '.agentdev/work/WP-05/transcript.md',
      '.agentdev/work/WP-05/conversation.md',
      '.agentdev/work/WP-05/chat_history.txt',
      'transcripts/session-1.md',
      'docs/conversation-notes.md',
      // W5R1-05: developer-prefixed chat/transcript exports are the same class of
      // record and must be denied by the marker, not merely by a missing prefix.
      'docs/dev-chat.md',
      'docs/developer-transcript.md',
    ];
    for (const [role, stage] of roleStagePairs()) {
      const scope = scopeFor(role, stage, PROJECT);
      if (scope === null) continue;
      for (const path of deniedPaths) {
        const decision = canRead(role, stage, gitSource(path), scope);
        expect(decision.allowed, `${role}:${stage} ${path}`).toBe(false);
        if (!decision.allowed) expect(decision.code).toBe('CONTEXT_FORBIDDEN');
      }
    }
  });

  it('rejects the documented path markers and accepts ordinary documents', () => {
    expect(isDeniedSourcePath('.agentdev/work/WP-05/chat.log')).toBe(true);
    expect(isDeniedSourcePath('.agentdev/work/WP-05/transcript.json')).toBe(true);
    expect(isDeniedSourcePath('nested/dir/conversation.md')).toBe(true);
    expect(isDeniedSourcePath('transcripts/run-1.md')).toBe(true);
    expect(isDeniedSourcePath('.agentdev/work/WP-05/plan.md')).toBe(false);
    expect(isDeniedSourcePath('src/chat.ts')).toBe(false);
    expect(isDeniedSourcePath('docs/rules/agents.md')).toBe(false);
    // W5R1-05 markers, and the ordinary files they must not swallow.
    for (const marker of [
      'docs/dev-chat.md',
      'docs/developer-transcript.md',
      'docs/dev-transcript.json',
      'docs/developer-chat-log.md',
      'dev-chat/notes.md',
    ]) {
      expect(isDeniedSourcePath(marker), marker).toBe(true);
    }
    for (const ordinary of ['src/developer-chat.ts', 'docs/development.md', 'src/dev-chat.ts']) {
      expect(isDeniedSourcePath(ordinary), ordinary).toBe(false);
    }
  });

  it('refuses the dev-chat markers for a role whose prefixes would admit them (W5R1-05)', () => {
    // `docs/dev-chat.md` sits inside the readable `docs` prefix, so only the marker
    // denies it; the same holds for the developer-transcript export.
    const scope = scopeFor('chief', 'assist', PROJECT);
    if (scope === null) throw new Error('chief must have a scope');
    for (const path of ['docs/dev-chat.md', 'docs/developer-transcript.md']) {
      const decision = canRead('chief', 'assist', gitSource(path), scope);
      expect(decision.allowed, path).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe('CONTEXT_FORBIDDEN');
        expect(decision.message).toContain('Transcript');
      }
    }
  });

  it('lets a Developer read the user request but never the transcript', () => {
    const scope = scopeFor('backend', 'develop-L2', PROJECT);
    if (scope === null) throw new Error('backend must have a scope');
    expect(canRead('backend', 'develop-L2', messageSource(), scope).allowed).toBe(true);
    expect(
      canRead('backend', 'develop-L2', gitSource('.agentdev/work/WP-05/chat.log'), scope).allowed,
    ).toBe(false);
  });
});

describe('context ACL — cross-project isolation (AC-034)', () => {
  const otherProject = '22222222222222222222222222222222';

  it('denies a source that belongs to another Project', () => {
    const scope = scopeFor('chief', 'assist', PROJECT);
    if (scope === null) throw new Error('chief must have a scope');
    const decision = canRead(
      'chief',
      'assist',
      artifactSource('product', { projectId: otherProject }),
      scope,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe('CONTEXT_FORBIDDEN');
      expect(decision.message).toContain(otherProject);
    }
  });

  it('denies another Project source whatever the source class', () => {
    const scope = scopeFor('backend', 'develop-L2', PROJECT);
    if (scope === null) throw new Error('backend must have a scope');
    const others: readonly ContextSourceRef[] = [
      artifactSource('plan', { projectId: otherProject }),
      gitSource('docs/product/orders.md', { projectId: otherProject }),
      messageSource({ projectId: otherProject }),
      { kind: 'policy', id: 'policy-1', version: '1', projectId: otherProject },
      { kind: 'knowledge', id: 'F-a1b2c3d4', version: '1', projectId: otherProject },
    ];
    for (const source of others) {
      const decision = canRead('backend', 'develop-L2', source, scope);
      expect(decision.allowed, `${source.kind}:${source.id}`).toBe(false);
      if (!decision.allowed) expect(decision.code).toBe('CONTEXT_FORBIDDEN');
    }
  });

  it('accepts a source of the same Project', () => {
    const scope = scopeFor('chief', 'assist', PROJECT);
    if (scope === null) throw new Error('chief must have a scope');
    const decision = canRead(
      'chief',
      'assist',
      artifactSource('product', { projectId: PROJECT.projectId }),
      scope,
    );
    expect(decision.allowed).toBe(true);
  });
});

describe('context ACL — Run isolation (context.md §5)', () => {
  const otherRun = '0191f000-0000-7000-8000-0000000000ff';
  const thisRun = '0191f000-0000-7000-8000-0000000000ee';

  it('denies another Run Session/Checkpoint to Review', () => {
    const scope = scopeFor('review', 'review', PROJECT);
    if (scope === null) throw new Error('review must have a scope');
    for (const source of [
      { kind: 'policy' as const, id: 'session-other-run', version: '1', ownedRunId: otherRun },
      {
        kind: 'role_contract' as const,
        id: 'checkpoint-other-run',
        version: '1',
        ownedRunId: otherRun,
      },
      gitSource('.agentdev/sessions/other-run/session.json', { ownedRunId: otherRun }),
    ]) {
      const decision = canRead('review', 'review', source, scope, { runId: thisRun });
      expect(decision.allowed, source.id).toBe(false);
      if (!decision.allowed) expect(decision.code).toBe('CONTEXT_FORBIDDEN');
    }
  });

  it('denies a Session without an owner and without a reader Run binding', () => {
    const scope = scopeFor('review', 'review', PROJECT);
    if (scope === null) throw new Error('review must have a scope');
    const unowned: ContextSourceRef = { kind: 'policy', id: 'session-1', version: '1' };
    expect(canRead('review', 'review', unowned, scope, { runId: thisRun }).allowed).toBe(false);
    expect(canRead('review', 'review', unowned, scope).allowed).toBe(false);
  });

  it('allows the current Run its own Session/Checkpoint', () => {
    const scope = scopeFor('review', 'review', PROJECT);
    if (scope === null) throw new Error('review must have a scope');
    const own: ContextSourceRef = {
      kind: 'policy',
      id: 'session-1',
      version: '1',
      ownedRunId: thisRun,
    };
    expect(canRead('review', 'review', own, scope, { runId: thisRun }).allowed).toBe(true);
  });
});

describe('context ACL — future artifacts (AC-079)', () => {
  it('denies a future artifact class to an earlier stage', () => {
    const scope = scopeFor('planning', 'planning', PROJECT);
    if (scope === null) throw new Error('planning must have a scope');
    const decision = canRead('planning', 'planning', artifactSource('review'), scope);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('CONTEXT_FORBIDDEN');
  });

  it('denies review/test artifacts to a Developer', () => {
    for (const artifactClass of ['review', 'test', 'settlement'] as const) {
      const scope = scopeFor('backend', 'develop-L2', PROJECT);
      if (scope === null) throw new Error('backend must have a scope');
      const decision = canRead(
        'backend',
        'develop-L2',
        artifactSource(artifactClass, { path: `${ARTIFACT_ROOT}/${artifactClass}/x` }),
        scope,
      );
      expect(decision.allowed, artifactClass).toBe(false);
    }
  });

  it('keeps a plan readable to Review and Test but not a settlement report', () => {
    const reviewScope = scopeFor('review', 'review', PROJECT);
    const testScope = scopeFor('test', 'test', PROJECT);
    if (reviewScope === null || testScope === null) throw new Error('scopes required');
    expect(canRead('review', 'review', artifactSource('plan'), reviewScope).allowed).toBe(true);
    expect(canRead('test', 'test', artifactSource('plan'), testScope).allowed).toBe(true);
    expect(canRead('review', 'review', artifactSource('settlement'), reviewScope).allowed).toBe(
      false,
    );
    expect(canRead('test', 'test', artifactSource('settlement'), testScope).allowed).toBe(false);
  });

  it('derives the artifact class from the blob path when it is not declared', () => {
    const scope = scopeFor('review', 'review', PROJECT);
    if (scope === null) throw new Error('review must have a scope');
    const undeclared: ContextSourceRef = {
      kind: 'artifact',
      id: '0191f000-0000-7000-8000-0000000000cc',
      version: '1',
      path: `${ARTIFACT_ROOT}/diff/abcd`,
    };
    expect(canRead('review', 'review', undeclared, scope).allowed).toBe(true);
    const future: ContextSourceRef = { ...undeclared, path: `${ARTIFACT_ROOT}/settlement/abcd` };
    expect(canRead('review', 'review', future, scope).allowed).toBe(false);
    expect(artifactClassFromPath(`${ARTIFACT_ROOT}/plan/xyz`)).toBe('plan');
    expect(artifactClassFromPath('src/orders/cancel.ts')).toBeNull();
  });

  it('refuses an artifact whose class cannot be established', () => {
    const scope = scopeFor('chief', 'assist', PROJECT);
    if (scope === null) throw new Error('chief must have a scope');
    const decision = canRead(
      'chief',
      'assist',
      { kind: 'artifact', id: '0191f000-0000-7000-8000-0000000000dd', version: '1' },
      scope,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('VALIDATION_ERROR');
  });

  it('lets a downstream stage read a Chief-session decision or attachment (W5R1-03)', () => {
    const productScope = scopeFor('product', 'product', PROJECT);
    const developerScope = scopeFor('backend', 'develop-L2', PROJECT);
    if (productScope === null || developerScope === null) throw new Error('scopes required');
    // Product takes its `confirmedSource` from a user decision (`requirements.ts`).
    expect(productScope.artifactClasses).toContain('decision');
    expect(canRead('product', 'product', artifactSource('decision'), productScope).allowed).toBe(
      true,
    );
    // A Developer reads the attachment it was pointed at.
    expect(developerScope.artifactClasses).toContain('attachment');
    expect(
      canRead('backend', 'develop-L2', artifactSource('attachment'), developerScope).allowed,
    ).toBe(true);
    // Every role that declares a Chief-session class can actually reach it, so the
    // matrix and the stage filter cannot contradict each other again.
    for (const [role, stage] of roleStagePairs()) {
      const scope = scopeFor(role, stage, PROJECT);
      if (scope === null) continue;
      for (const artifactClass of ['decision', 'attachment', 'log', 'recovery'] as const) {
        if (!ROLE_ARTIFACT_CLASSES[role].includes(artifactClass)) continue;
        expect(scope.artifactClasses, `${role}:${stage}`).toContain(artifactClass);
      }
    }
  });

  it('still refuses a future pipeline artifact to an earlier stage (W5R1-03, AC-079)', () => {
    const productScope = scopeFor('product', 'product', PROJECT);
    const planningScope = scopeFor('planning', 'planning', PROJECT);
    const l1Scope = scopeFor('backend', 'develop-L1', PROJECT);
    if (productScope === null || planningScope === null || l1Scope === null) {
      throw new Error('scopes required');
    }
    // Product runs before Planning: the Plan is a future product.
    expect(productScope.artifactClasses).not.toContain('plan');
    expect(canRead('product', 'product', artifactSource('plan'), productScope).allowed).toBe(false);
    // Planning runs before Review/Test.
    for (const artifactClass of ['review', 'test'] as const) {
      expect(
        canRead('planning', 'planning', artifactSource(artifactClass), planningScope).allowed,
        artifactClass,
      ).toBe(false);
    }
    // L1 Develop reads the CompactPlan but never the Review/Test/Settlement report.
    for (const artifactClass of ['review', 'test', 'settlement'] as const) {
      expect(
        canRead('backend', 'develop-L1', artifactSource(artifactClass), l1Scope).allowed,
        artifactClass,
      ).toBe(false);
    }
  });

  it('lets an L1 Develop read nothing from a future Plan', () => {
    const scope = scopeFor('backend', 'develop-L1', PROJECT);
    if (scope === null) throw new Error('backend must have a scope');
    expect(scope.artifactClasses).not.toContain('review');
    expect(scope.artifactClasses).not.toContain('test');
    expect(scope.artifactClasses).toContain('plan');
  });

  it('derives every declared artifact class from a legal stage (W5R1-03)', () => {
    // The union over a role's stages must equal the declared matrix: a class that
    // is declared but reachable at no stage is the W5R1-03 defect.
    for (const role of CONTEXT_ROLES) {
      const reachable = new Set<ArtifactClass>();
      for (const stage of ROLE_STAGES[role]) {
        const scope = scopeFor(role, stage, PROJECT);
        if (scope === null) continue;
        for (const artifactClass of scope.artifactClasses) reachable.add(artifactClass);
      }
      expect([...reachable].sort(), role).toEqual([...ROLE_ARTIFACT_CLASSES[role]].sort());
    }
  });
});

describe('context ACL — read scope', () => {
  it('limits the current Work to its own process directory', () => {
    const scope = scopeFor('backend', 'develop-L2', PROJECT);
    if (scope === null) throw new Error('backend must have a scope');
    expect(canRead('backend', 'develop-L2', gitSource('src/orders/cancel.ts'), scope).allowed).toBe(
      true,
    );
    expect(
      canRead('backend', 'develop-L2', gitSource('.agentdev/work/WP-04/plan.md'), scope).allowed,
      'another Work process directory is out of scope',
    ).toBe(false);
    expect(
      canRead('backend', 'develop-L2', gitSource(`.agentdev/work/${PROJECT.workId}/plan.md`), scope)
        .allowed,
    ).toBe(true);
  });

  it('refuses paths outside the project roots', () => {
    const scope = scopeFor('chief', 'assist', PROJECT);
    if (scope === null) throw new Error('chief must have a scope');
    expect(canRead('chief', 'assist', gitSource('webui/index.html'), scope).allowed).toBe(false);
    expect(canRead('chief', 'assist', gitSource('docker/Dockerfile'), scope).allowed).toBe(false);
  });

  it('keeps node_modules, dist and .git out of every scope', () => {
    for (const [role, stage] of roleStagePairs()) {
      const scope = scopeFor(role, stage, PROJECT);
      if (scope === null) continue;
      for (const denied of ['.git/config', 'node_modules/zod/index.js', 'dist/index.js']) {
        const decision = canRead(role, stage, gitSource(denied), scope);
        expect(decision.allowed, `${role}:${stage} ${denied}`).toBe(false);
      }
    }
  });

  it('records the project roots as read prefixes', () => {
    const scope = scopeFor('planning', 'planning', PROJECT);
    if (scope === null) throw new Error('planning must have a scope');
    expect(scope.pathPrefixes).toContain('src');
    expect(scope.pathPrefixes).toContain('docs');
    expect(scope.pathPrefixes).toContain('.agentdev');
    expect(scope.pathPrefixes).toContain(`.agentdev/work/${PROJECT.workId}`);
  });

  it('omits the Work prefix when the Project scope names no Work', () => {
    const scope = scopeFor('chief', 'assist', {
      projectId: PROJECT.projectId,
      codeRoot: PROJECT.codeRoot,
      documentRoot: PROJECT.documentRoot,
      deliveryBranch: PROJECT.deliveryBranch,
    });
    expect(scope).not.toBeNull();
    expect(scope?.pathPrefixes.some((prefix) => prefix.startsWith('.agentdev/work'))).toBe(false);
    expect(scope?.pathPrefixes).toContain('.agentdev');
  });

  it('denies a path-escaping or hidden-tree source to every role', () => {
    const denied = [
      '../etc/passwd',
      'src/../../etc/passwd',
      '.agentdev/sessions/run-1.json',
      '.agentdev/checkpoints/run-1.json',
    ];
    for (const [role, stage] of roleStagePairs()) {
      const scope = scopeFor(role, stage, PROJECT);
      if (scope === null) continue;
      for (const path of denied) {
        const decision = canRead(role, stage, gitSource(path), scope);
        expect(decision.allowed, `${role}:${stage} ${path}`).toBe(false);
      }
    }
  });
});

describe('context ACL — legacy whole-repository root (W5R1-11)', () => {
  // `knowledge.md` §5 initialises an old Project with `code-root=.`; the root is
  // the whole repository, not a directory literally named `.`, so a Developer must
  // still be able to read the authorised source tree.
  const LEGACY: ProjectScope = {
    projectId: PROJECT.projectId,
    codeRoot: '.',
    documentRoot: 'docs/agentdev',
    deliveryBranch: PROJECT.deliveryBranch,
  };

  it('reads repository code from a "."-rooted project', () => {
    const scope = scopeFor('backend', 'develop-L2', LEGACY);
    if (scope === null) throw new Error('backend must have a scope');
    expect(scope.pathPrefixes).not.toContain('.');
    expect(scope.pathPrefixes).toContain('');
    for (const path of [
      'src/orders/cancel.ts',
      'packages/core/src/index.ts',
      'docs/agentdev/PROJECT.md',
    ]) {
      expect(canRead('backend', 'develop-L2', gitSource(path), scope).allowed, path).toBe(true);
    }
  });

  it('still denies permanent denials and transcript markers in a "."-rooted project', () => {
    const scope = scopeFor('backend', 'develop-L2', LEGACY);
    if (scope === null) throw new Error('backend must have a scope');
    for (const path of [
      '.git/config',
      'node_modules/zod/index.js',
      'dist/index.js',
      'docs/dev-chat.md',
      'docs/developer-transcript.md',
      'transcripts/run-1.md',
    ]) {
      const decision = canRead('backend', 'develop-L2', gitSource(path), scope);
      expect(decision.allowed, path).toBe(false);
      if (!decision.allowed) expect(decision.code).toBe('CONTEXT_FORBIDDEN');
    }
  });
});

describe('context ACL — denial vocabulary', () => {
  it('only ever denies with CONTEXT_FORBIDDEN or VALIDATION_ERROR', () => {
    const candidates: readonly ContextSourceRef[] = [
      gitSource('webui/index.html'),
      gitSource('.git/config'),
      gitSource('node_modules/zod/index.js'),
      gitSource('.agentdev/work/WP-04/plan.md'),
      gitSource('.agentdev/work/WP-05/chat.log'),
      { kind: 'transcript', id: 'conversation-1', version: '1' },
      messageSource(),
      artifactSource('review'),
      artifactSource('settlement'),
      { kind: 'artifact', id: '0191f000-0000-7000-8000-0000000000dd', version: '1' },
      { kind: 'role_contract', id: 'session-of-another-run', version: '1' },
      { kind: 'git', id: 'docs/INDEX.md', version: '1', projectId: 'f'.repeat(32) },
    ];
    for (const [role, stage] of roleStagePairs()) {
      const scope = scopeFor(role, stage, PROJECT);
      if (scope === null) continue;
      for (const source of candidates) {
        const decision = canRead(role, stage, source, scope, { runId: 'run-1' });
        if (decision.allowed) continue;
        expect(
          ['CONTEXT_FORBIDDEN', 'VALIDATION_ERROR'],
          `${role}:${stage} ${source.kind}:${source.id} -> ${decision.code}`,
        ).toContain(decision.code);
      }
    }
  });

  it('denies the transcript kind even when the reader owns the source', () => {
    for (const [role, stage] of roleStagePairs()) {
      const scope = scopeFor(role, stage, PROJECT);
      if (scope === null) continue;
      const decision = canRead(
        role,
        stage,
        { kind: 'transcript', id: 'conversation-1', version: '1', ownedRunId: 'run-1' },
        scope,
        { runId: 'run-1' },
      );
      expect(decision.allowed, `${role}:${stage}`).toBe(false);
    }
  });
});

describe('context ACL — explainDenial', () => {
  it('returns null for an allowed source', () => {
    const scope = scopeFor('chief', 'assist', PROJECT);
    if (scope === null) throw new Error('chief must have a scope');
    expect(explainDenial('chief', 'assist', gitSource('docs/INDEX.md'), scope)).toBeNull();
  });

  it('returns the error code and message for a denied source', () => {
    const scope = scopeFor('test', 'test', PROJECT);
    if (scope === null) throw new Error('test must have a scope');
    const denial = explainDenial('test', 'test', messageSource(), scope);
    expect(denial).not.toBeNull();
    expect(denial?.code).toBe('CONTEXT_FORBIDDEN');
    expect(denial?.message.length).toBeGreaterThan(0);
    expect(denial?.ref.id).toBe('message-user-1');
  });

  it('never returns a denial for a granted kind on a legal pair', () => {
    for (const [role, stage] of roleStagePairs()) {
      const scope = scopeFor(role, stage, PROJECT);
      const kinds = readableSourceKinds(role, stage);
      if (scope === null || kinds === null) continue;
      for (const kind of kinds) {
        expect(scope.sourceKinds).toContain(kind);
      }
    }
  });
});

describe('context ACL — source vocabulary', () => {
  it('maps Context source classes onto storage SourceRef kinds', () => {
    expect(toSourceRefKind('git')).toBe('git');
    expect(toSourceRefKind('artifact')).toBe('artifact');
    expect(toSourceRefKind('policy')).toBe('policy');
    expect(toSourceRefKind('role_contract')).toBe('policy');
    expect(toSourceRefKind('knowledge')).toBe('git');
    expect(toSourceRefKind('transcript')).toBe('message');
    expect(toSourceRefKind('message')).toBe('message');
    expect(fromSourceRefKind('action')).toBe('message');
    expect(fromSourceRefKind('decision')).toBe('policy');
    for (const kind of SOURCE_KINDS) {
      expect(SOURCE_KINDS).toContain(fromSourceRefKind(toSourceRefKind(kind)));
    }
  });

  it('classifies message senders into the three documented classes', () => {
    expect(classifyMessageSender('user')).toBe('user_request');
    expect(classifyMessageSender('system')).toBe('system_notice');
    expect(classifyMessageSender('chief')).toBe('agent_result');
    expect(classifyMessageSender('role')).toBe('agent_result');
  });

  it('covers every role with an explicit message-class row', () => {
    for (const role of CONTEXT_ROLES) {
      expect(ROLE_MESSAGE_CLASSES[role], role).toBeDefined();
      expect(Array.isArray(ROLE_MESSAGE_CLASSES[role])).toBe(true);
    }
  });

  it('documents one artifact-class row per role and keeps them non-empty', () => {
    for (const role of CONTEXT_ROLES) {
      expect(ROLE_ARTIFACT_CLASSES[role].length, role).toBeGreaterThan(0);
      expect(new Set(ROLE_ARTIFACT_CLASSES[role]).size).toBe(ROLE_ARTIFACT_CLASSES[role].length);
    }
  });
});
