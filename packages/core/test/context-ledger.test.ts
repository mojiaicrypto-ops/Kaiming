/**
 * The append-only read ledger (`docs/architecture/context.md` §1/§5,
 * `docs/architecture/data.md` §2 `stage_result`, `docs/rules/agents.md` §2/§4).
 *
 * Each test is one documented obligation of the ledger, not an implementation
 * detail:
 *
 * - a reasoned read inside `readScope` is appended with `seq/path/revision/hash/
 *   reason/size`, `seq` starts at 1 and only grows (`AC-032`);
 * - a read outside the scope is `CONTEXT_FORBIDDEN` and a read without a reason is
 *   `VALIDATION_ERROR`; neither is appended;
 * - the budget is charged as reads are admitted, and a read that does not fit is
 *   refused with `BUDGET_EXCEEDED` *naming the gap* instead of injecting more
 *   (`AC-036`);
 * - a wider read needs a recorded, reasoned `context.request` and a grant; a
 *   denial changes nothing (`AC-032`, `AC-036`);
 * - `seal()` commits the ordered entries to one `(seq, hash)` chain, refuses later
 *   appends, and `verifySeal` rejects an older seq or a different hash while
 *   re-sealing stays idempotent (`AC-085`);
 * - `entries()`/`usage()`/`readScope()`/`expansions()`/`sealedBinding()` are frozen
 *   copies, so a caller can read state but never rewrite history.
 *
 * The ledger is driven through the real `acl.scopeFor` scopes and the real
 * character token estimator, and the seal chain is independently recomputed from
 * the documented hash input so a change to that input would fail these tests.
 */
import { describe, expect, it } from 'vitest';
import { sha256 } from '@agentdev/storage';
import type { ErrorCode, Hash, SourceRef, Time } from '@agentdev/contracts';
import {
  READ_LEDGER_SEAL_GENESIS,
  characterTokenCounter,
  createReadLedger,
  readLedgerSealHash,
  scopeFor,
  type ContextRequest,
  type ContextRole,
  type ContextStage,
  type ExpansionRecord,
  type LedgerError,
  type ProjectScope,
  type ReadLedger,
  type ReadLedgerBudget,
  type ReadLedgerEntry,
  type ReadLedgerResult,
  type ReadScope,
} from '../src/context/index.js';
import { canonicalJson } from '../src/dispatcher.js';

const PROJECT: ProjectScope = {
  projectId: '11111111111111111111111111111111',
  codeRoot: 'src',
  documentRoot: 'docs',
  deliveryBranch: 'agentdev/main',
  workId: '0191f000-0000-7000-8000-000000000001',
};

const OTHER_PROJECT_ID = '22222222222222222222222222222222';
const RUN_ID = '0191f000-0000-7000-8000-0000000000aa';
const REVISION = 'a1b2c3d4'.repeat(5);
const OTHER_REVISION = 'f9e8d7c6'.repeat(5);
const FIXED_TIME: Time = '2026-09-11T00:00:00.000Z';

const tokensOf = (content: string): number => characterTokenCounter(content);

/** A body whose character count is a multiple of four, so its tokens are exact. */
const body = (marker: string, chars: number): string => marker.repeat(chars);

function expectOk<T>(result: ReadLedgerResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
  const value: T = result;
  return value;
}

function expectRefusal<T>(result: ReadLedgerResult<T>, code: ErrorCode): LedgerError {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error(`expected a refusal with ${code}`);
  const error = result.errors[0];
  if (error === undefined) throw new Error(`expected an error entry for ${code}`);
  expect(error.code).toBe(code);
  return error;
}

interface OpenOptions {
  readonly role?: ContextRole;
  readonly stage?: ContextStage;
  readonly budget?: ReadLedgerBudget;
  readonly revision?: string;
}

function openLedger(options: OpenOptions = {}): { ledger: ReadLedger; scope: ReadScope } {
  const role = options.role ?? 'backend';
  const stage = options.stage ?? 'develop-L2';
  const scope = scopeFor(role, stage, PROJECT);
  if (scope === null) throw new Error(`no ACL scope for ${role}:${stage}`);
  const created = createReadLedger({
    runId: RUN_ID,
    role,
    stage,
    scope,
    budget: options.budget ?? { initialTokens: 10_000, expansionTokens: 0 },
    revision: options.revision ?? REVISION,
    now: () => FIXED_TIME,
  });
  return { ledger: expectOk(created).ledger, scope };
}

/** A scope widened by one extra readable prefix, as a granted request would be. */
function widened(scope: ReadScope, prefix: string): ReadScope {
  return { ...scope, pathPrefixes: [...scope.pathPrefixes, prefix] };
}

function requestFor(path: string, reason = '关联调用方影响本次改动'): ContextRequest {
  return {
    ref: { kind: 'git', id: path, version: REVISION, path },
    reason,
    requestedBy: 'backend',
  };
}

function entryAt(ledger: ReadLedger, index: number): ReadLedgerEntry {
  const entry = ledger.entries()[index];
  if (entry === undefined) throw new Error(`no ledger entry at ${index}`);
  return entry;
}

/** The documented seal chain, recomputed independently of the implementation. */
function computeSeal(entries: readonly ReadLedgerEntry[]): Hash {
  let accumulator = sha256(READ_LEDGER_SEAL_GENESIS);
  for (const entry of entries) {
    accumulator = sha256(
      canonicalJson({
        prev: accumulator,
        seq: entry.seq,
        path: entry.path,
        revision: entry.revision,
        hash: entry.hash,
        reason: entry.reason,
        bytes: entry.bytes,
      }),
    );
  }
  return accumulator;
}

describe('read ledger — append inside readScope (AC-032)', () => {
  it('appends a reasoned read with its full identity and accounts its tokens', () => {
    const { ledger } = openLedger({ budget: { initialTokens: 4_096, expansionTokens: 0 } });
    const content = 'export const cancel = () => confirmed;\n';

    const appended = expectOk(
      ledger.append({
        path: 'src/orders/cancel.ts',
        reason: '确认取消路由的当前行为',
        content,
      }),
    );

    expect(appended.seq).toBe(1);
    expect(appended.path).toBe('src/orders/cancel.ts');
    expect(appended.revision).toBe(REVISION);
    expect(appended.hash).toBe(sha256(content));
    expect(appended.bytes).toBe(Buffer.byteLength(content, 'utf8'));
    expect(appended.consumedTokens).toBe(tokensOf(content));
    expect(appended.remainingTokens).toBe(4_096 - tokensOf(content));

    expect(ledger.entries()).toEqual([
      {
        seq: 1,
        path: 'src/orders/cancel.ts',
        revision: REVISION,
        hash: sha256(content),
        reason: '确认取消路由的当前行为',
        bytes: Buffer.byteLength(content, 'utf8'),
        tokens: tokensOf(content),
        at: FIXED_TIME,
      },
    ]);
    expect(ledger.usage()).toEqual({
      initial: { limit: 4_096, used: tokensOf(content) },
      expansion: { limit: 0, used: 0 },
      consumedTokens: tokensOf(content),
      remainingTokens: 4_096 - tokensOf(content),
      entries: 1,
    });
  });

  it('allocates seq 1..n in append order and never reuses a number', () => {
    const { ledger } = openLedger();
    const paths = ['src/a.ts', 'src/b.ts', 'docs/INDEX.md'];
    const seqs = paths.map(
      (path) =>
        expectOk(ledger.append({ path, reason: `读取 ${path}`, content: `// ${path}\n` })).seq,
    );
    expect(seqs).toEqual([1, 2, 3]);
    expect(ledger.entries().map((entry) => entry.path)).toEqual(paths);
    expect(new Set(ledger.entries().map((entry) => entry.seq)).size).toBe(3);
  });

  it('inherits the Run revision and lets one read override it', () => {
    const { ledger } = openLedger();
    expectOk(ledger.append({ path: 'src/a.ts', reason: '继承 Run revision', content: 'a\n' }));
    expectOk(
      ledger.append({
        path: 'docs/INDEX.md',
        reason: '读取文档索引的特定 revision',
        content: 'b\n',
        revision: OTHER_REVISION,
      }),
    );
    expect(entryAt(ledger, 0).revision).toBe(REVISION);
    expect(entryAt(ledger, 1).revision).toBe(OTHER_REVISION);
  });

  it('admits Feature navigation as shared knowledge', () => {
    const { ledger } = openLedger();
    const appended = expectOk(
      ledger.append({
        path: 'features/F-a1b2c3d4/README.md',
        reason: 'Feature 导航',
        content: '# 订单取消\n',
      }),
    );
    expect(appended.seq).toBe(1);
  });

  it('refuses a path outside readScope with CONTEXT_FORBIDDEN and appends nothing', () => {
    const { ledger } = openLedger();
    const error = expectRefusal(
      ledger.append({ path: 'vendor/other.ts', reason: '尝试越界读取', content: 'x\n' }),
      'CONTEXT_FORBIDDEN',
    );
    expect(error.message).toContain('vendor/other.ts');
    expect(ledger.entries()).toHaveLength(0);
    expect(ledger.usage().initial.used).toBe(0);
    expect(ledger.usage().remainingTokens).toBe(10_000);
  });

  it('refuses a Transcript path even when it sits inside a readable prefix (AC-033)', () => {
    const { ledger } = openLedger();
    expectRefusal(
      ledger.append({
        path: 'docs/transcripts/develop-chat.md',
        reason: '读取开发聊天',
        content: 'transcript\n',
      }),
      'CONTEXT_FORBIDDEN',
    );
    expect(ledger.entries()).toHaveLength(0);
  });

  it('refuses the developer-chat/dev-transcript path markers (W5R1-05)', () => {
    const { ledger } = openLedger();
    for (const path of ['docs/dev-chat.md', 'docs/developer-transcript.md']) {
      expectRefusal(
        ledger.append({ path, reason: '读取开发聊天导出', content: 'chat contents\n' }),
        'CONTEXT_FORBIDDEN',
      );
    }
    expect(ledger.entries()).toHaveLength(0);
  });

  it('closes a throwing counter or clock instead of escaping (W5R1-10)', () => {
    const scope = scopeFor('backend', 'develop-L2', PROJECT);
    if (scope === null) throw new Error('missing scope');
    const withBadCounter = createReadLedger({
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      scope,
      budget: { initialTokens: 24_000, expansionTokens: 0 },
      tokenCounter: () => {
        throw new Error('counter boom: secret-token');
      },
    });
    const counterLedger = expectOk(withBadCounter).ledger;
    const counterError = expectRefusal(
      counterLedger.append({ path: 'src/a.ts', reason: '计数器异常', content: 'a\n' }),
      'INTERNAL_ERROR',
    );
    expect(counterError.message).not.toContain('secret-token');
    expect(counterLedger.entries()).toHaveLength(0);

    const withBadClock = createReadLedger({
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      scope,
      budget: { initialTokens: 24_000, expansionTokens: 0 },
      now: () => {
        throw new Error('clock boom: secret-token');
      },
    });
    const clockLedger = expectOk(withBadClock).ledger;
    const clockError = expectRefusal(
      clockLedger.append({ path: 'src/a.ts', reason: '时钟异常', content: 'a\n' }),
      'INTERNAL_ERROR',
    );
    expect(clockError.message).not.toContain('secret-token');
    expect(clockLedger.usage().initial.used).toBe(0);
    expect(clockLedger.entries()).toHaveLength(0);
  });

  it('refuses another Work process directory', () => {
    const { ledger } = openLedger();
    expectRefusal(
      ledger.append({
        path: '.agentdev/work/WP-99/plan.md',
        reason: '读取其他 Work 的过程记录',
        content: 'plan\n',
      }),
      'CONTEXT_FORBIDDEN',
    );
  });

  it('refuses an artifact class the stage may not read yet', () => {
    const { ledger } = openLedger({ role: 'review', stage: 'review' });
    expectRefusal(
      ledger.append({
        path: 'artifacts/test/0191f0000000700080000000000000aa',
        reason: '试图读取未来阶段的 Test 产物',
        content: 'test result\n',
      }),
      'CONTEXT_FORBIDDEN',
    );
    expect(ledger.entries()).toHaveLength(0);
  });

  it('refuses a read without a written reason with VALIDATION_ERROR', () => {
    const { ledger } = openLedger();
    const error = expectRefusal(
      ledger.append({ path: 'src/a.ts', reason: '   ', content: 'a\n' }),
      'VALIDATION_ERROR',
    );
    expect(error.path).toBe('src/a.ts');
    expect(ledger.entries()).toHaveLength(0);
  });

  it('refuses a malformed path before it can reach the ACL', () => {
    const { ledger } = openLedger();
    expectRefusal(
      ledger.append({ path: '', reason: '空路径', content: 'a\n' }),
      'VALIDATION_ERROR',
    );
    expectRefusal(
      ledger.append({ path: 'src\\a.ts', reason: '反斜杠路径', content: 'a\n' }),
      'VALIDATION_ERROR',
    );
    expect(ledger.entries()).toHaveLength(0);
  });
});

describe('read ledger — budget accounting (AC-036)', () => {
  it('charges the startup package and refuses the read that would exceed the ceiling', () => {
    // `body(marker, 4 * n)` costs exactly `n` tokens under the character/4
    // estimator, so the documented minimum ceiling can be exhausted exactly.
    const first = body('a', 16_384);
    const second = body('b', 96);
    const { ledger } = openLedger({
      budget: { initialTokens: tokensOf(first), expansionTokens: 0 },
    });
    expect(tokensOf(first)).toBe(4_096);

    const appended = expectOk(
      ledger.append({ path: 'src/a.ts', reason: '第一处读取', content: first }),
    );
    expect(appended.consumedTokens).toBe(4_096);
    expect(appended.remainingTokens).toBe(0);

    const error = expectRefusal(
      ledger.append({ path: 'src/b.ts', reason: '第二处读取', content: second }),
      'BUDGET_EXCEEDED',
    );
    expect(error.path).toBe('src/b.ts');
    expect(error.requiredTokens).toBe(24);
    expect(error.remainingTokens).toBe(0);
    expect(error.message).toContain('src/b.ts');
    expect(error.message).toContain('需要 24 tokens');
    expect(error.message).toContain('剩余 0 tokens');

    // The refused read is not appended and does not move the accounting.
    expect(ledger.entries()).toHaveLength(1);
    expect(ledger.usage().initial).toEqual({ limit: 4_096, used: 4_096 });
    expect(ledger.usage().consumedTokens).toBe(4_096);
  });

  it('accounts tokens the frozen startup package already spent', () => {
    const { ledger } = openLedger({
      budget: { initialTokens: 4_096, initialUsed: 4_090, expansionTokens: 0 },
    });
    expect(ledger.usage()).toEqual({
      initial: { limit: 4_096, used: 4_090 },
      expansion: { limit: 0, used: 0 },
      consumedTokens: 0,
      remainingTokens: 6,
      entries: 0,
    });

    expectOk(
      ledger.append({ path: 'src/a.ts', reason: '使用剩余初始预算', content: body('a', 24) }),
    );
    expect(ledger.usage().initial).toEqual({ limit: 4_096, used: 4_096 });
    expect(ledger.usage().remainingTokens).toBe(0);

    const error = expectRefusal(
      ledger.append({ path: 'src/b.ts', reason: '超出剩余初始预算', content: body('b', 32) }),
      'BUDGET_EXCEEDED',
    );
    expect(error.requiredTokens).toBe(8);
    expect(error.remainingTokens).toBe(0);
  });

  it('refuses invalid budget input when the ledger is created', () => {
    const scope = scopeFor('backend', 'develop-L2', PROJECT);
    if (scope === null) throw new Error('missing scope');
    for (const budget of [
      { initialTokens: -1, expansionTokens: 0 },
      { initialTokens: 1.5, expansionTokens: 0 },
      { initialTokens: 4096.5, expansionTokens: 0 },
      { initialTokens: 4_095, expansionTokens: 0 },
      { initialTokens: 2_000_001, expansionTokens: 0 },
      { initialTokens: 1e15, expansionTokens: 0 },
      { initialTokens: 10, expansionTokens: -4 },
      { initialTokens: 24_000, expansionTokens: 4_095 },
      { initialTokens: 10, initialUsed: 11, expansionTokens: 0 },
    ]) {
      const created = createReadLedger({
        runId: RUN_ID,
        role: 'backend',
        stage: 'develop-L2',
        scope,
        budget,
        now: () => FIXED_TIME,
      });
      expectRefusal(created, 'VALIDATION_ERROR');
    }
  });

  it('accepts the documented budget boundaries and the explicit empty budget', () => {
    const scope = scopeFor('backend', 'develop-L2', PROJECT);
    if (scope === null) throw new Error('missing scope');
    for (const budget of [
      { initialTokens: 4_096, expansionTokens: 0 },
      { initialTokens: 2_000_000, expansionTokens: 16_000 },
      { initialTokens: 0, expansionTokens: 0 },
    ]) {
      const created = createReadLedger({
        runId: RUN_ID,
        role: 'backend',
        stage: 'develop-L2',
        scope,
        budget,
        now: () => FIXED_TIME,
      });
      expect(created.ok, JSON.stringify(budget)).toBe(true);
    }
  });
});

describe('read ledger — reasoned expansion (AC-032, AC-036)', () => {
  it('keeps reads beyond the scope impossible until a grant widens it', () => {
    const { ledger, scope } = openLedger({ budget: { initialTokens: 4_096, expansionTokens: 0 } });
    const request = requestFor('vendor/shared-types.ts');

    expectRefusal(
      ledger.append({ path: 'vendor/shared-types.ts', reason: '直接越界读取', content: 'x\n' }),
      'CONTEXT_FORBIDDEN',
    );

    const recorded = expectOk(ledger.requestExpansion({ request }));
    expect(recorded.expansion.decision).toBe('pending');
    expect(recorded.expansion.requestedAt).toBe(FIXED_TIME);
    expect(ledger.readScope().pathPrefixes).toEqual(scope.pathPrefixes);

    // A pending request grants nothing: the read is still refused.
    expectRefusal(
      ledger.append({
        path: 'vendor/shared-types.ts',
        reason: '请求尚未授权',
        content: 'x\n',
      }),
      'CONTEXT_FORBIDDEN',
    );

    const granted = expectOk(
      ledger.grantExpansion({ request, granted: true, expandedScope: widened(scope, 'vendor') }),
    );
    expect(granted.expansion.decision).toBe('granted');
    expect(granted.expansion.expandedScope?.pathPrefixes).toContain('vendor');
    expect(ledger.readScope().pathPrefixes).toContain('vendor');

    const appended = expectOk(
      ledger.append({
        path: 'vendor/shared-types.ts',
        reason: '授权后读取调用方类型',
        content: body('v', 32),
      }),
    );
    expect(appended.seq).toBe(1);
    expect(ledger.expansions()).toHaveLength(1);
    expect(ledger.expansions()[0]?.decision).toBe('granted');
  });

  it('makes granted extra tokens usable and still enforces the ceiling without them', () => {
    // The documented minimum ceiling, exhausted exactly (16 384 characters = 4096
    // tokens), so the ceiling is real without using a sub-minimum budget.
    const first = body('a', 16_384);
    const second = body('b', 96);
    const { ledger, scope } = openLedger({
      budget: { initialTokens: tokensOf(first), expansionTokens: 0 },
    });
    expect(tokensOf(first)).toBe(4_096);
    const request = requestFor('vendor/shared-types.ts');

    expectOk(ledger.append({ path: 'src/a.ts', reason: '第一处读取', content: first }));
    expect(ledger.usage().remainingTokens).toBe(0);

    // A wider scope without tokens widens the *scope* but not the budget.
    expectOk(ledger.requestExpansion({ request }));
    expectOk(
      ledger.grantExpansion({ request, granted: true, expandedScope: widened(scope, 'vendor') }),
    );
    expectRefusal(
      ledger.append({
        path: 'vendor/shared-types.ts',
        reason: '范围已放宽但预算未增加',
        content: second,
      }),
      'BUDGET_EXCEEDED',
    );

    // A second, token-bearing grant makes the same read fit.
    expectOk(ledger.requestExpansion({ request }));
    const granted = expectOk(
      ledger.grantExpansion({
        request,
        granted: true,
        expandedScope: widened(scope, 'vendor'),
        extraTokens: tokensOf(second),
      }),
    );
    expect(granted.expansion.extraTokens).toBe(24);

    const appended = expectOk(
      ledger.append({
        path: 'vendor/shared-types.ts',
        reason: '扩展预算内读取',
        content: second,
      }),
    );
    expect(appended.consumedTokens).toBe(24);
    expect(appended.remainingTokens).toBe(0);
    expect(ledger.usage()).toEqual({
      initial: { limit: 4_096, used: 4_096 },
      expansion: { limit: 24, used: 24 },
      consumedTokens: 4_120,
      remainingTokens: 0,
      entries: 2,
    });
  });

  it('records a denied request without changing the ledger', () => {
    const { ledger, scope } = openLedger();
    const request = requestFor('vendor/shared-types.ts');
    const usageBefore = ledger.usage();

    expectOk(ledger.requestExpansion({ request }));
    const denied = expectOk(
      ledger.grantExpansion({ request, granted: false, note: '不在本次 Work 范围' }),
    );
    expect(denied.expansion.decision).toBe('denied');
    expect(denied.expansion.decidedAt).toBe(FIXED_TIME);
    expect(denied.expansion.note).toBe('不在本次 Work 范围');
    expect(denied.expansion.expandedScope).toBeUndefined();
    expect(denied.expansion.extraTokens).toBeUndefined();

    expect(ledger.entries()).toHaveLength(0);
    expect(ledger.usage()).toEqual(usageBefore);
    expect(ledger.readScope().pathPrefixes).toEqual(scope.pathPrefixes);
    expectRefusal(
      ledger.append({ path: 'vendor/shared-types.ts', reason: '被拒绝后仍读取', content: 'x\n' }),
      'CONTEXT_FORBIDDEN',
    );
  });

  it('refuses a denial that smuggles scope or tokens', () => {
    const { ledger, scope } = openLedger();
    const request = requestFor('vendor/shared-types.ts');
    expectOk(ledger.requestExpansion({ request }));
    expectRefusal(
      ledger.grantExpansion({ request, granted: false, expandedScope: widened(scope, 'vendor') }),
      'VALIDATION_ERROR',
    );
    expectRefusal(
      ledger.grantExpansion({ request, granted: false, extraTokens: 10 }),
      'VALIDATION_ERROR',
    );
    // The request is still pending, so a clean denial can still be recorded.
    expect(expectOk(ledger.grantExpansion({ request, granted: false })).expansion.decision).toBe(
      'denied',
    );
  });

  it('refuses a decision for a request that was never made with NOT_FOUND', () => {
    const { ledger, scope } = openLedger();
    const never = requestFor('unrequested/file.ts');
    expectRefusal(
      ledger.grantExpansion({
        request: never,
        granted: true,
        expandedScope: widened(scope, 'vendor'),
      }),
      'NOT_FOUND',
    );
  });

  it('refuses an expansion that would narrow the scope or change Project', () => {
    const { ledger, scope } = openLedger();
    const request = requestFor('vendor/shared-types.ts');
    expectOk(ledger.requestExpansion({ request }));
    expectRefusal(
      ledger.grantExpansion({
        request,
        granted: true,
        expandedScope: {
          ...scope,
          projectId: OTHER_PROJECT_ID,
          pathPrefixes: [...scope.pathPrefixes, 'vendor'],
        },
      }),
      'VALIDATION_ERROR',
    );
    expectRefusal(
      ledger.grantExpansion({
        request,
        granted: true,
        expandedScope: {
          ...scope,
          pathPrefixes: scope.pathPrefixes.filter((prefix) => prefix !== 'src').concat('vendor'),
        },
      }),
      'VALIDATION_ERROR',
    );
    // Nothing was granted, so the wider read is still refused.
    expectRefusal(
      ledger.append({ path: 'vendor/shared-types.ts', reason: '无效授权后读取', content: 'x\n' }),
      'CONTEXT_FORBIDDEN',
    );
  });

  it('refuses a grant that drops the permanent denials (W5R1-04)', () => {
    const { ledger, scope } = openLedger();
    const request = requestFor('vendor/shared-types.ts');
    expectOk(ledger.requestExpansion({ request }));

    // A "wider" scope that widens the allowed prefixes but erases the permanent
    // denials would make `.git/config` and `node_modules` readable; the grant must
    // be refused because an expansion may only widen, never narrow, constraints.
    expectRefusal(
      ledger.grantExpansion({
        request,
        granted: true,
        expandedScope: { ...scope, pathPrefixes: [''], deniedPaths: [] },
      }),
      'VALIDATION_ERROR',
    );
    // The ledger's scope and denials are untouched, so the denied paths stay denied.
    expect(ledger.readScope().deniedPaths).toEqual(scope.deniedPaths);
    for (const path of ['.git/config', 'node_modules/x/index.js']) {
      expectRefusal(
        ledger.append({ path, reason: '尝试读取永久拒绝路径', content: 'x\n' }),
        'CONTEXT_FORBIDDEN',
      );
    }
  });

  it('refuses a Transcript, an escaping path or a reasonless expansion request', () => {
    const { ledger } = openLedger();
    expectRefusal(
      ledger.requestExpansion({ request: requestFor('docs/transcripts/chat.md') }),
      'CONTEXT_FORBIDDEN',
    );
    expectRefusal(
      ledger.requestExpansion({ request: requestFor('../secrets/token.txt') }),
      'CONTEXT_FORBIDDEN',
    );
    expectRefusal(
      ledger.requestExpansion({
        request: {
          ref: { kind: 'git', id: 'vendor/x.ts', version: '1', path: 'vendor/x.ts' },
          reason: '',
        },
      }),
      'VALIDATION_ERROR',
    );
    expect(ledger.expansions()).toHaveLength(0);
  });

  it('refuses a duplicate pending request for the same source', () => {
    const { ledger } = openLedger();
    const request = requestFor('vendor/shared-types.ts');
    expectOk(ledger.requestExpansion({ request }));
    expectRefusal(ledger.requestExpansion({ request }), 'INVALID_STATE');
    expect(ledger.expansions()).toHaveLength(1);
  });
});

describe('read ledger — seal and stale binding (AC-085)', () => {
  it('seals the ordered entries and refuses every later append', () => {
    const { ledger } = openLedger();
    expect(ledger.sealedBinding()).toBeNull();
    expectOk(ledger.append({ path: 'src/a.ts', reason: '第一条', content: 'a\n' }));
    expectOk(ledger.append({ path: 'src/b.ts', reason: '第二条', content: 'b\n' }));

    const seal = expectOk(ledger.seal());
    expect(seal.seq).toBe(2);
    expect(seal.hash).toBe(computeSeal(ledger.entries()));
    expect(ledger.sealedBinding()).toEqual({ seq: 2, hash: seal.hash });

    const refused = expectRefusal(
      ledger.append({ path: 'src/c.ts', reason: '提交后再读取', content: 'c\n' }),
      'INVALID_STATE',
    );
    expect(refused.seq).toBe(2);
    expect(refused.hash).toBe(seal.hash);
    expect(ledger.entries()).toHaveLength(2);

    expectRefusal(ledger.requestExpansion({ request: requestFor('vendor/x.ts') }), 'INVALID_STATE');
    expectRefusal(
      ledger.grantExpansion({
        request: requestFor('vendor/x.ts'),
        granted: true,
        expandedScope: ledger.readScope(),
      }),
      'INVALID_STATE',
    );
  });

  it('re-sealing is idempotent', () => {
    const { ledger } = openLedger();
    expectOk(ledger.append({ path: 'src/a.ts', reason: '一条', content: 'a\n' }));
    const first = expectOk(ledger.seal());
    const second = expectOk(ledger.seal());
    const third = expectOk(ledger.seal());
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(ledger.sealedBinding()).toEqual({ seq: first.seq, hash: first.hash });
  });

  it('verifies the correct binding and rejects an older seq or a different hash', () => {
    const { ledger } = openLedger();
    expectOk(ledger.append({ path: 'src/a.ts', reason: '第一条', content: 'a\n' }));
    expectOk(ledger.append({ path: 'src/b.ts', reason: '第二条', content: 'b\n' }));
    const seal = expectOk(ledger.seal());

    expect(expectOk(ledger.verifySeal({ seq: seal.seq, hash: seal.hash }))).toEqual(seal);

    const stale = expectRefusal(ledger.verifySeal({ seq: 1, hash: seal.hash }), 'STALE_ARTIFACT');
    expect(stale.seq).toBe(1);
    expect(stale.message).toContain('旧 seq');

    expectRefusal(ledger.verifySeal({ seq: 2, hash: 'f'.repeat(64) }), 'STALE_ARTIFACT');
    expectRefusal(ledger.verifySeal({ seq: 3, hash: seal.hash }), 'VALIDATION_ERROR');
    expectRefusal(ledger.verifySeal({ seq: 2, hash: 'not-a-hash' }), 'VALIDATION_ERROR');
    expectRefusal(ledger.verifySeal({ seq: -1, hash: seal.hash }), 'VALIDATION_ERROR');
  });

  it('refuses verification while the ledger is still open', () => {
    const { ledger } = openLedger();
    expectRefusal(ledger.verifySeal({ seq: 0, hash: 'a'.repeat(64) }), 'INVALID_STATE');
  });

  it('seals an empty ledger to seq 0 so a no-read stage result still binds', () => {
    const { ledger } = openLedger();
    const seal = expectOk(ledger.seal());
    expect(seal.seq).toBe(0);
    expect(seal.hash).toBe(sha256(READ_LEDGER_SEAL_GENESIS));
    expect(expectOk(ledger.verifySeal({ seq: 0, hash: seal.hash }))).toEqual(seal);
  });

  it('is a stable chain over the documented entry fields', () => {
    const reads = [
      { path: 'src/a.ts', reason: '第一条', content: 'alpha\n' },
      { path: 'docs/INDEX.md', reason: '第二条', content: 'beta\n' },
    ] as const;

    const first = openLedger();
    const second = openLedger();
    for (const read of reads) {
      expectOk(first.ledger.append(read));
      expectOk(second.ledger.append(read));
    }
    const firstSeal = expectOk(first.ledger.seal());
    const secondSeal = expectOk(second.ledger.seal());

    // Same entries ⇒ same chain, and the chain equals the documented hash input.
    expect(secondSeal).toEqual(firstSeal);
    expect(firstSeal.hash).toBe(computeSeal(first.ledger.entries()));
    expect(firstSeal.hash).toBe(readLedgerSealHash(first.ledger.entries()));

    // Every documented field changes the seal when it changes.
    const base: ReadLedgerEntry = {
      seq: 1,
      path: 'src/a.ts',
      revision: REVISION,
      hash: 'c'.repeat(64),
      reason: '一条读取理由',
      bytes: 40,
      tokens: 10,
      at: FIXED_TIME,
    };
    const baseline = readLedgerSealHash([base]);
    expect(readLedgerSealHash([{ ...base }])).toBe(baseline);
    expect(readLedgerSealHash([{ ...base, seq: 2 }])).not.toBe(baseline);
    expect(readLedgerSealHash([{ ...base, path: 'src/b.ts' }])).not.toBe(baseline);
    expect(readLedgerSealHash([{ ...base, revision: OTHER_REVISION }])).not.toBe(baseline);
    expect(readLedgerSealHash([{ ...base, hash: 'd'.repeat(64) }])).not.toBe(baseline);
    expect(readLedgerSealHash([{ ...base, reason: '另一条理由' }])).not.toBe(baseline);
    expect(readLedgerSealHash([{ ...base, bytes: 41 }])).not.toBe(baseline);

    // Order and count are committed to as well.
    const reordered = openLedger();
    expectOk(reordered.ledger.append(reads[1]));
    expectOk(reordered.ledger.append(reads[0]));
    expect(expectOk(reordered.ledger.seal()).hash).not.toBe(firstSeal.hash);
    expect(readLedgerSealHash([base, { ...base, seq: 2 }])).not.toBe(
      readLedgerSealHash([{ ...base, seq: 2 }]),
    );
  });
});

describe('read ledger — immutable snapshot getters', () => {
  it('hands back frozen copies that cannot rewrite the ledger', () => {
    const { ledger, scope } = openLedger();
    expectOk(ledger.append({ path: 'src/a.ts', reason: '一条', content: 'alpha\n' }));
    expectOk(ledger.requestExpansion({ request: requestFor('vendor/x.ts') }));
    const seal = expectOk(ledger.seal());

    const entries = ledger.entries();
    expect(Object.isFrozen(entries)).toBe(true);
    expect(Object.isFrozen(entries[0])).toBe(true);
    expect(() =>
      (entries as unknown as ReadLedgerEntry[]).push({
        seq: 2,
        path: 'src/b.ts',
        revision: REVISION,
        hash: 'e'.repeat(64),
        reason: '注入条目',
        bytes: 1,
        tokens: 1,
        at: FIXED_TIME,
      }),
    ).toThrow();
    expect(() => {
      (entries[0] as unknown as { seq: number }).seq = 99;
    }).toThrow();
    expect(ledger.entries().map((entry) => entry.seq)).toEqual([1]);

    const usage = ledger.usage();
    expect(Object.isFrozen(usage)).toBe(true);
    expect(Object.isFrozen(usage.initial)).toBe(true);
    expect(() => {
      (usage as unknown as { remainingTokens: number }).remainingTokens = 999_999;
    }).toThrow();
    expect(ledger.usage().remainingTokens).toBe(10_000 - tokensOf('alpha\n'));

    const currentScope = ledger.readScope();
    expect(Object.isFrozen(currentScope)).toBe(true);
    expect(Object.isFrozen(currentScope.pathPrefixes)).toBe(true);
    expect(() => {
      (currentScope as unknown as { projectId: string }).projectId = OTHER_PROJECT_ID;
    }).toThrow();
    expect(ledger.readScope().projectId).toBe(scope.projectId);

    const expansions = ledger.expansions();
    expect(Object.isFrozen(expansions)).toBe(true);
    expect(Object.isFrozen(expansions[0])).toBe(true);
    expect(Object.isFrozen(expansions[0]?.request)).toBe(true);
    expect(Object.isFrozen(expansions[0]?.request.ref)).toBe(true);
    expect(() => {
      (expansions[0] as unknown as { decision: string }).decision = 'granted';
    }).toThrow();
    expect(ledger.expansions()[0]?.decision).toBe('pending');

    const binding = ledger.sealedBinding();
    expect(Object.isFrozen(binding)).toBe(true);
    expect(() => {
      (binding as unknown as { seq: number }).seq = 0;
    }).toThrow();
    expect(ledger.sealedBinding()).toEqual({ seq: seal.seq, hash: seal.hash });
    expect(ledger.identity()).toEqual({ runId: RUN_ID, role: 'backend', stage: 'develop-L2' });
  });

  it('does not leak internal state through a granted expansion copy', () => {
    const { ledger, scope } = openLedger();
    const request = requestFor('vendor/x.ts');
    expectOk(ledger.requestExpansion({ request }));
    expectOk(
      ledger.grantExpansion({
        request,
        granted: true,
        expandedScope: widened(scope, 'vendor'),
        extraTokens: 32,
      }),
    );
    const record = ledger.expansions()[0] as ExpansionRecord;
    expect(Object.isFrozen(record.expandedScope)).toBe(true);
    expect(() => {
      (record.expandedScope as unknown as { pathPrefixes: string[] }).pathPrefixes = [];
    }).toThrow();
    expect(ledger.readScope().pathPrefixes).toContain('vendor');
  });
});

describe('read ledger — creation validation', () => {
  it('refuses an unknown role or stage and an empty Run id', () => {
    const scope = scopeFor('backend', 'develop-L2', PROJECT);
    if (scope === null) throw new Error('missing scope');
    const base = {
      runId: RUN_ID,
      role: 'backend' as ContextRole,
      stage: 'develop-L2' as ContextStage,
      scope,
      budget: { initialTokens: 10, expansionTokens: 0 },
      now: () => FIXED_TIME,
    };
    expectRefusal(createReadLedger({ ...base, runId: '  ' }), 'VALIDATION_ERROR');
    expectRefusal(createReadLedger({ ...base, role: 'nobody' as ContextRole }), 'VALIDATION_ERROR');
    expectRefusal(
      createReadLedger({ ...base, stage: 'unknown-stage' as ContextStage }),
      'VALIDATION_ERROR',
    );
  });

  it('refuses a source ref that is not a storage handle', () => {
    const { ledger } = openLedger();
    const bad = { ref: {} as SourceRef, reason: '不合法 ref' };
    expectRefusal(ledger.requestExpansion({ request: bad }), 'VALIDATION_ERROR');
  });
});
