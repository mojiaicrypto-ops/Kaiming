/**
 * The live drill's real stack (WP-10 T3).
 *
 * `pnpm test:live` must run the product, not a simulation of it, so this module boots
 * the same real components `pnpm test:e2e` uses — a temporary Git project on the
 * Product's delivery branch, a real SQLite `ProjectStore`, the real Core services, the
 * real `createDaemon` (HTTP `/rpc` + `/artifacts/*`) and the real `createWebApp` BFF —
 * and then adds the two things only a Provider drill has:
 *
 * 1. a real `ConfigStore` Provider entry whose `secret_ref` resolves through the real
 *    `SecretStore` under a Work-scoped `secret` Grant (AC-051/AC-043), and
 * 2. a real `ModelGateway` wired to {@link createOpenAiCompatibleTransport}, so every
 *    completion travels the product's own frozen-config path
 *    (`model-gateway.complete(run, messages)`) to the endpoint the user configured.
 *
 * The credential value never leaves the process: the ConfigStore stores only the ref,
 * the Gateway resolves it at call time, and the transport masks it in every recorded
 * failure.
 */
import { join } from 'node:path';

import {
  REPO_ROOT,
  cleanupTempDirs,
  cookiePair,
  git,
  httpRequest,
  jsonOf,
  loadProduct,
  makeTempDir,
  writeFileAt,
  revisionOf,
} from './e2e-runtime.mjs';
import { LIVE_SECRET_REF } from './live-transport.mjs';

/** The exact `Origin` both the daemon and the BFF allow (`protocol.md` §2). */
export const WEB_ORIGIN = 'http://127.0.0.1:4317';

/** Delivery branch and document root of the drill project (`ARCHITECTURE.md` §4). */
export const DELIVERY_REF = 'refs/heads/agentdev/main';
export const DOCUMENT_ROOT = 'docs/agentdev';

/** Seeded capability ids/paths; the same shapes `docs/delivery/acceptance.md` §4 names. */
export const FEATURE_ID = 'F-0a1b2c3d';
export const OTHER_FEATURE_ID = 'F-0f0f0f0f';
export const FEATURE_PATH = `${DOCUMENT_ROOT}/features/${FEATURE_ID}/README.md`;
export const OTHER_FEATURE_PATH = `${DOCUMENT_ROOT}/features/${OTHER_FEATURE_ID}/README.md`;
export const CODE_PATH = 'src/orders/cancel.ts';
export const TEST_PATH = 'tests/orders/cancel.test.ts';
export const COPY_PATH = 'src/orders/messages.ts';
export const PAYMENT_PATH = 'src/payments/status.ts';

/** The seeded copy typo the L1 drill replaces (`workflow.md` §2 step 4). */
export const TYPO_BEFORE = "export const unpaidCancelLabel = 'Unpaid oreder can be cacnelled';\n";
export const TYPO_EXPECTED = "export const unpaidCancelLabel = 'Unpaid order can be cancelled';\n";

/** Ensures a condition; every refusal carries the observed value. */
export function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

/** Unwraps a workspace port `Result`, failing with the port's own message. */
export function unwrap(result, what) {
  if (!result.ok) throw new Error(`${what}: ${result.errors[0]?.message ?? 'git failed'}`);
  return result.value;
}

/** A valid Feature document in the Product's own format (`context.md` §2). */
export function featureMarkdown(input) {
  return [
    `# ${input.name}`,
    '',
    '| 字段 | 值 |',
    '|---|---|',
    `| feature_id | ${input.featureId} |`,
    `| name | ${input.name} |`,
    '| module | orders |',
    `| owner_document | ${input.path} |`,
    '| design | unconfirmed |',
    '| design_decision_refs | 无 |',
    `| implementation | ${input.implementation ?? 'partial'} |`,
    `| verification | ${input.verification ?? 'unverified'} |`,
    `| verification_evidence_refs | ${input.verificationEvidenceRefs ?? '无'} |`,
    `| verification_coverage | ${input.verificationCoverage ?? '无'} |`,
    '| investigation | investigated |',
    '| investigation_scope | 订单取消路由与状态转换 |',
    `| source_refs | git:${input.revision}:${CODE_PATH} |`,
    `| revision | ${input.revision} |`,
    '',
    '## 用途',
    '',
    `${input.name}的能力说明。`,
    '',
    '## 当前行为',
    '',
    input.behaviour,
    '',
    '## 关系',
    '',
    input.relations ?? '无',
    '',
    '## 实现入口',
    '',
    ...input.entries.map((entry) => `- ${entry}`),
    '',
    '## 已知差距',
    '',
    ...(input.gaps === undefined ? ['无已登记差距。'] : input.gaps.map((gap) => `- ${gap}`)),
    '',
    '## 关键决定',
    '',
    `- 按需求确认的行为处理（seed ${input.decisionRef}）。`,
    '',
  ].join('\n');
}

/**
 * Boots the real stack with the configured Provider.
 *
 * @param {object} input
 * @param {Awaited<ReturnType<typeof loadProduct>>} input.product
 * @param {ReturnType<import('./live-transport.mjs').readProviderEnvironment>} input.provider
 * @param {import('./live-transport.mjs').OpenAiCompatibleTransport} input.transport
 * @param {Record<string, unknown>} input.meta
 */
export async function bootLiveStack({ product, provider, transport, meta }) {
  const {
    core,
    storage,
    workspace,
    knowledge,
    daemon: daemonModule,
    daemonProtocol,
    web: webModule,
  } = product;

  const repo = makeTempDir('agentdev-live-repo-');
  const dataDir = makeTempDir('agentdev-live-state-');
  const stateDir = makeTempDir('agentdev-live-auth-');
  const gitPort = workspace.createNodeWorktreeGitPort();

  // 1. A real project: code, a presentation-only copy file (the L1 drill's target) and
  //    two Feature documents, committed together on the delivery branch.
  writeFileAt(
    repo,
    CODE_PATH,
    [
      'export interface Order {',
      '  readonly id: string;',
      "  readonly status: 'unpaid' | 'paid';",
      '}',
      '',
      'const orders: Order[] = [',
      "  { id: 'O-1', status: 'unpaid' },",
      "  { id: 'O-2', status: 'paid' },",
      '];',
      '',
      'export const cancel = (orderId: string): boolean => {',
      '  void orderId;',
      '  return false;',
      '};',
      '',
    ].join('\n'),
  );
  writeFileAt(repo, TEST_PATH, "import { cancel } from '../../src/orders/cancel';\n");
  writeFileAt(repo, COPY_PATH, TYPO_BEFORE);
  writeFileAt(repo, PAYMENT_PATH, 'export const paid = (): boolean => false;\n');
  writeFileAt(
    repo,
    FEATURE_PATH,
    featureMarkdown({
      featureId: FEATURE_ID,
      name: '订单取消',
      path: FEATURE_PATH,
      revision: '0'.repeat(40),
      behaviour: '未付款订单不可取消。',
      entries: [CODE_PATH],
      decisionRef: 'decision:live-seed',
    }),
  );
  writeFileAt(
    repo,
    OTHER_FEATURE_PATH,
    featureMarkdown({
      featureId: OTHER_FEATURE_ID,
      name: '支付状态',
      path: OTHER_FEATURE_PATH,
      revision: '0'.repeat(40),
      behaviour: '付款状态决定可取消范围。',
      entries: [PAYMENT_PATH],
      decisionRef: 'decision:live-seed',
    }),
  );
  unwrap(gitPort.initRepository(repo, { branch: 'agentdev/main' }), 'git init');
  writeFileAt(repo, '.gitignore', 'node_modules/\n.agentdev/work/\n');
  const seed = unwrap(
    gitPort.commitPaths(repo, 'chore: seed the live drill delivery branch', [
      CODE_PATH,
      TEST_PATH,
      COPY_PATH,
      PAYMENT_PATH,
      FEATURE_PATH,
      OTHER_FEATURE_PATH,
      '.gitignore',
    ]),
    'seed commit',
  );
  const seedRevision = seed.revision;

  // 2. The real ProjectStore and Core services.
  const store = storage.ProjectStore.open({
    dataDir,
    canonicalRoot: repo,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    repository: { now: () => new Date().toISOString() },
  });
  const projectId = storage.projectIdFromRoot(repo);
  const blobs = new storage.BlobStore({ root: dataDir });

  let authClockMs = Date.now();
  const auth = core.AuthService.loadOrCreate({
    stateDir,
    config: {
      deployment: 'loopback',
      allowedOrigins: [WEB_ORIGIN],
      sessionTtlMs: 60 * 60 * 1000,
      now: () => authClockMs,
    },
  });
  const installationToken = auth.createdToken ?? '';
  ensure(installationToken !== '', 'the auth service created no installation token');

  const attachments = new core.AttachmentService({ store, blobs });
  const artifacts = new core.ArtifactService({ store, blobs });
  const tokens = new core.DownloadTokenStore();
  const events = new core.EventHub({ store });
  const snapshots = new core.SnapshotWriter({ store });

  // 3. The real Provider configuration: `config.toml` names only the secret ref; the
  //    value lives in the real SecretStore (`rules/agents.md` §5).
  const config = core.ConfigStore.open({
    globalDir: stateDir,
    projectRoot: dataDir,
    snapshots,
  });
  const providerEntry = config.upsertProvider({
    type: 'openai-compatible',
    baseUrl: provider.baseUrl,
    enabled: true,
    secretRef: LIVE_SECRET_REF,
    models: [
      {
        id: provider.modelId,
        contextWindow: provider.contextWindow,
        maxOutputTokens: provider.maxOutputTokens,
        reasoningLevels: ['off'],
        vision: false,
      },
      ...(provider.reviewModelId === null || provider.reviewModelId === provider.modelId
        ? []
        : [
            {
              id: provider.reviewModelId,
              contextWindow: provider.contextWindow,
              maxOutputTokens: provider.maxOutputTokens,
              reasoningLevels: ['off'],
              vision: false,
            },
          ]),
    ],
  });
  const reviewModelId = provider.reviewModelId ?? provider.modelId;
  const roleOverrides = {};
  for (const role of ['chief', 'planning', 'backend', 'frontend', 'settlement']) {
    roleOverrides[role] = {
      providerId: providerEntry.providerId,
      modelId: provider.modelId,
      reasoning: 'off',
      skills: [],
      toolSubset: [],
      contextLimit: 32_000,
    };
  }
  // Review and Test get their own model when the environment names one (AC-043); the
  // drill still proves per-role frozen configuration either way.
  for (const role of ['review', 'test']) {
    roleOverrides[role] = {
      providerId: providerEntry.providerId,
      modelId: reviewModelId,
      reasoning: 'off',
      skills: [],
      toolSubset: [],
      contextLimit: 32_000,
    };
  }
  config.update('global', { roleOverrides });

  const secrets = new core.SecretStore();
  secrets.put({
    ref: LIVE_SECRET_REF,
    value: provider.secret,
    audience: 'gateway',
    purposes: ['analysis', 'artifact', 'implementation', 'review', 'test', 'settlement'],
  });
  // The Gateway resolves the Provider credential through the real SecretStore
  // admission path (`gatewaySecretResolver`): the resolver closes over the Grant the
  // drill registered for the Run being served, so a call with no matching Grant is a
  // refusal, never a value. The context is mutated per call because each Run mints its
  // own Work-scoped Grant.
  const secretContext = {
    audience: 'gateway',
    purpose: 'analysis',
    role: 'chief',
    workId: '',
    stage: 'assist',
    at: new Date().toISOString(),
    grants: [],
  };
  let activeGrant;
  const secretResolver = core.gatewaySecretResolver(secrets, secretContext);
  const gateway = new core.ModelGateway({
    config,
    snapshots,
    transport,
    secrets: {
      resolve: (secretRef) => {
        if (activeGrant === undefined) return undefined;
        secretContext.role = activeGrant.role;
        secretContext.stage = activeGrant.stage;
        secretContext.workId = activeGrant.workId ?? '';
        secretContext.at = new Date().toISOString();
        secretContext.grants = [activeGrant];
        return secretResolver.resolve(secretRef);
      },
    },
  });

  const gates = new core.PlanGateService({ store, artifacts, blobs });
  const findings = new core.FindingService({ store, artifacts });
  const decisions = new core.DecisionService({ store, artifacts });
  const requirements = new core.RequirementContinuation({ store });
  const journal = workspace.createMemoryCasJournal();
  const casEvents = workspace.createMemoryCasEvents();
  const cas = workspace.createCasService({ git: gitPort, journal, events: casEvents });
  const lock = new core.ProjectIntegrationLock({ projectId, leases: store.leases });
  const settlement = new core.SettlementService({
    store,
    worktrees: gitPort,
    cas,
    journal,
    events: casEvents,
    snapshots,
  });
  const requirementSaves = core.createRequirementSaveService({
    store,
    worktrees: gitPort,
    journal,
    events: casEvents,
    cas,
    lock,
    worktreeRoot: join(dataDir, 'save-worktrees'),
    keepWorktree: false,
  });
  const protocol = new daemonProtocol.WorkbenchProtocol({
    store,
    blobs,
    events,
    attachments,
    artifacts,
    tokens,
    version: '0.0.0-live',
    config,
    gates,
    decisions,
    findings,
    requirements,
    requirementSaves,
  });

  store.projects.insert({
    id: projectId,
    root: repo,
    gitRoot: repo,
    codeRoot: 'src',
    documentRoot: DOCUMENT_ROOT,
    deliveryBranch: 'agentdev/main',
    trust: 'trusted',
    state: 'open',
    head: seedRevision,
  });
  const conversationId = store.newId();
  store.conversations.insert({
    id: conversationId,
    projectId,
    title: 'live chief conversation',
    archived: false,
  });

  // 4. The real daemon (HTTP) and the real BFF, both on loopback port 0.
  const daemonServer = daemonModule.createDaemon({
    projectId,
    store,
    blobs,
    auth,
    attachments,
    artifacts,
    tokens,
    version: '0.0.0-live',
    workbench: protocol,
  });
  await new Promise((resolve) => daemonServer.listen(0, '127.0.0.1', resolve));
  const daemonAddress = daemonServer.address();
  const daemonPort =
    typeof daemonAddress === 'object' && daemonAddress !== null ? daemonAddress.port : 0;
  const daemonUrl = `http://127.0.0.1:${String(daemonPort)}`;

  const app = webModule.createWebApp({
    daemon: { baseUrl: daemonUrl, origin: WEB_ORIGIN, bearer: installationToken },
    auth,
    allowedOrigins: [WEB_ORIGIN],
    sessions: new webModule.WebSessionStore(),
    files: new webModule.NodeFilePort(),
    version: '0.0.0-live',
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const webAddress = app.server.address();
  const webPort = typeof webAddress === 'object' && webAddress !== null ? webAddress.port : 0;
  const webUrl = `http://127.0.0.1:${String(webPort)}`;

  // 5. Publish the seed knowledge projection so `knowledge.list` reads real rows.
  const initialDocuments = readFeatureDocuments(repo);
  const initialProjection = knowledge.buildProjection({
    documents: initialDocuments,
    revision: seedRevision,
    codeTreeRevision: seedRevision,
    knownIds: [],
    documentRoot: DOCUMENT_ROOT,
    cache: core.createSqliteProjectionCache({ store }),
  });
  if (!initialProjection.published) {
    throw new Error(
      `the seeded Feature documents are invalid: ${JSON.stringify(initialProjection.diagnostics)}`,
    );
  }

  Object.assign(meta, {
    projectRoot: repo,
    dataDir,
    daemonUrl,
    webUrl,
    webOrigin: WEB_ORIGIN,
    providerBaseUrl: provider.baseUrl,
    providerId: providerEntry.providerId,
    modelId: provider.modelId,
    reviewModelId,
    seedRevision,
  });

  let cookie = '';
  let csrfToken = '';
  /** Grants whose scope authorizes `secret` on the live ref; built like the real rows. */
  const secretGrants = [];

  /**
   * Registers the Work-scoped authority the Gateway resolves the credential under.
   *
   * `data.md` §2 fixes the `grant` row shape, and `domain.evaluateGrant` is what the
   * SecretStore re-runs; the row is created here because the drill seeds its Runs
   * directly (the product has no protocol method that mints a Provider Grant).
   */
  const authorizeGatewaySecret = ({ workId, role, stage, runId }) => {
    const at = new Date().toISOString();
    const grant = {
      id: store.newId(),
      projectId,
      version: 1,
      createdAt: at,
      updatedAt: at,
      workId,
      scope: 'work',
      role,
      stage,
      operation: 'secret',
      targets: [LIVE_SECRET_REF],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      limits: {},
      decisionId: store.newId(),
      ...(runId === undefined ? {} : { runId }),
    };
    secretGrants.push(grant);
    activeGrant = grant;
    return grant;
  };

  // The Runner child process loads the repository sources (no build needed), through the
  // same loader this harness uses for the product.
  const runnerEntry = join(dataDir, 'runner-entry.mjs');
  writeFileAt(
    dataDir,
    'runner-entry.mjs',
    [
      `import { installSourceResolver } from ${JSON.stringify(join(REPO_ROOT, 'scripts', 'lib', 'e2e-runtime.mjs'))};`,
      'installSourceResolver();',
      `const { main } = await import(${JSON.stringify(join(REPO_ROOT, 'apps', 'runner', 'src', 'cli.ts'))});`,
      'await main(process.argv.slice(2), {',
      '  output: { write: (line) => process.stdout.write(line) },',
      '  exit: (code) => process.exit(code),',
      '});',
      '',
    ].join('\n'),
  );
  const { createPrepareRun } = await import('../../apps/daemon/src/prepare-run.ts');
  const { createChildRunnerSpawnPort } = await import('../../apps/daemon/src/runner-spawn.ts');

  const harness = {
    product,
    repo,
    dataDir,
    stateDir,
    seedRevision,
    store,
    blobs,
    auth,
    attachments,
    artifacts,
    tokens,
    events,
    snapshots,
    config,
    secrets,
    liveSecretRef: LIVE_SECRET_REF,
    /** Builds the Runner invocation for one Attempt (WP-11 A2-T7). */
    prepareRun: ({ capabilities, gatewayUrl }) =>
      createPrepareRun({
        store,
        config,
        capabilities,
        gatewayUrl,
        projectRoot: repo,
        attemptsDir: join(dataDir, 'attempts'),
        log: () => undefined,
      }),
    /** Starts a real `apps/runner` child process over the repository sources. */
    runnerSpawn: () =>
      createChildRunnerSpawnPort({
        repoRoot: REPO_ROOT,
        env: { ...process.env, AGENTDEV_RUNNER_ENTRY: runnerEntry },
        log: () => undefined,
      }),
    gateway,
    transport,
    gates,
    findings,
    decisions,
    requirements,
    requirementSaves,
    settlement,
    cas,
    gitPort,
    protocol,
    daemonServer,
    app,
    daemonUrl,
    webUrl,
    projectId,
    conversationId,
    installationToken,
    providerId: providerEntry.providerId,
    modelId: provider.modelId,
    reviewModelId,
    featurePath: FEATURE_PATH,
    otherFeaturePath: OTHER_FEATURE_PATH,
    codePath: CODE_PATH,
    testPath: TEST_PATH,
    copyPath: COPY_PATH,
    advanceAuthClock(ms) {
      authClockMs += ms;
    },
    setSession(value) {
      cookie = value.cookie;
      csrfToken = value.csrfToken;
    },
    get cookie() {
      return cookie;
    },
    get csrfToken() {
      return csrfToken;
    },
    async close() {
      protocol.closeAll(1001, 'the live drill finished');
      await new Promise((resolve) => app.server.close(() => resolve()));
      await new Promise((resolve) => daemonServer.close(() => resolve()));
      store.close();
    },
    roots: [repo, dataDir, stateDir],
  };

  harness.login = async (token = installationToken, origin = WEB_ORIGIN) =>
    httpRequest(`${webUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ token }),
    });

  let requestSequence = 0;
  harness.rpc = async (method, params = {}, rpcOptions = {}) => {
    requestSequence += 1;
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json',
      origin: rpcOptions.origin ?? WEB_ORIGIN,
    };
    if (rpcOptions.cookie !== null) headers.cookie = rpcOptions.cookie ?? cookie;
    if (rpcOptions.csrfToken !== null && (rpcOptions.csrfToken ?? csrfToken) !== '') {
      headers['x-csrf-token'] = rpcOptions.csrfToken ?? csrfToken;
    }
    const response = await httpRequest(`${webUrl}/rpc`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        v: 1,
        type: 'request',
        id: `live-${String(requestSequence)}`,
        method,
        projectId: rpcOptions.projectId ?? projectId,
        params,
        ...(rpcOptions.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: rpcOptions.idempotencyKey }),
      }),
    });
    return { status: response.status, headers: response.headers, frame: jsonOf(response) };
  };

  harness.accepted = async (method, params = {}, rpcOptions = {}) => {
    const answer = await harness.rpc(method, params, rpcOptions);
    ensure(
      answer.frame.ok === true,
      `${method} was refused with ${String(answer.frame.error?.code)}: ${String(answer.frame.error?.message)}`,
    );
    return answer.frame.result ?? {};
  };

  /** One HTTP request to the daemon itself, authenticated with the CLI credential. */
  harness.daemon = (path, options = {}) =>
    httpRequest(`${daemonUrl}${path}`, {
      ...options,
      headers: {
        accept: '*/*',
        authorization: `Bearer ${installationToken}`,
        ...(options.headers ?? {}),
      },
    });

  /**
   * Runs one real completion for a role through the real Gateway.
   *
   * All three snapshots are real rows: the `config` one is what the Gateway reads
   * (frozen model/provider/secret ref), the `context` and `dispatch` ones record the
   * drill's selection just as a Chief dispatch would.
   */
  harness.callModel = async ({
    workId,
    taskId,
    role,
    purpose,
    stage,
    messages,
    goal = 'live drill',
    /**
     * Optional `(text) => boolean` gate. A real agent re-asks when the model returns a
     * reply it cannot use (a truncated or malformed JSON object), so the same Run and the
     * same frozen configuration are retried up to `maxAttempts` times instead of failing
     * the drill on one bad completion.
     */
    validate,
    maxAttempts = 3,
  }) => {
    const frozen = config.freeze(role, {});
    const contextSnapshot = snapshots.freeze('context', {
      goal,
      role,
      sourceRefs: [{ kind: 'git', id: seedRevision, version: '1' }],
    });
    const dispatchSnapshot = snapshots.freeze('dispatch', {
      kind: role === 'chief' ? 'chief' : 'professional',
      workId,
      role,
      purpose,
      stage,
      goal,
    });
    const run = store.runs.insert({
      id: store.newId(),
      projectId,
      workId,
      ...(taskId === undefined ? {} : { taskId }),
      role,
      purpose,
      stage,
      status: 'running',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: frozen.snapshotId,
      contextSnapshotId: contextSnapshot.hash,
      dispatchSnapshotId: dispatchSnapshot.hash,
      budgetAllocation: 50_000,
    });
    authorizeGatewaySecret({
      workId,
      role,
      stage,
      runId: run.id,
    });
    let response = await gateway.complete(run, messages);
    let attempts = 1;
    while (
      typeof validate === 'function' &&
      response.ok &&
      validate(response.text) !== true &&
      attempts < maxAttempts
    ) {
      attempts += 1;
      process.stdout.write(
        `live: model reply was unusable (attempt ${String(attempts - 1)}/${String(maxAttempts)}); asking the same frozen Run again\n`,
      );
      response = await gateway.complete(run, messages);
    }
    return { run, response, resolution: frozen.resolution, attempts };
  };

  /**
   * Probes the configured endpoint through the Gateway's own `testConnection`.
   *
   * It is a real minimal completion (`provider.test`) against the frozen Provider, so
   * "the endpoint answers" is demonstrated rather than assumed.
   */
  harness.probeProvider = async () => {
    authorizeGatewaySecret({
      workId: 'live-provider-probe',
      role: 'chief',
      stage: 'assist',
    });
    return gateway.testConnection(providerEntry.providerId, provider.modelId);
  };

  return harness;
}

/** Reads the two seeded Feature documents at `HEAD`. */
export function readFeatureDocuments(repo) {
  const read = (path) => ({
    relativePath: path,
    markdown: git(['show', `HEAD:${path}`], repo),
  });
  return [read(FEATURE_PATH), read(OTHER_FEATURE_PATH)];
}

/** The current revision of the delivery branch. */
export function deliveryRevision(repo) {
  return revisionOf(repo, DELIVERY_REF);
}

/**
 * Reads a committed file at a revision with the real `git` binary.
 *
 * @param {string} repo
 * @param {string} revision
 * @param {string} path
 */
export function gitShow(repo, revision, path) {
  return git(['show', `${revision}:${path}`], repo);
}

/** Closes the harness and removes every temporary directory it created. */
export async function shutdownLiveStack(harness, keepTemp) {
  if (harness !== undefined) await harness.close();
  if (!keepTemp) cleanupTempDirs();
  else if (harness !== undefined) {
    process.stdout.write(`live: keeping temporary directories: ${harness.roots.join(', ')}\n`);
  }
}

/** The installation token's user id, exposed so a check can assert the owner. */
export function installationUserId() {
  return 'installation:local';
}

/** Re-exports the loader so `live.mjs` has one import for the whole stack. */
export { REPO_ROOT, cookiePair, loadProduct };
