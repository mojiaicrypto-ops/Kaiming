/**
 * The three longitudinal live drills (WP-10 T3).
 *
 * Each drill drives the real stack with the real Provider and asserts **product
 * facts** — rows, refs, hashes, HTTP headers, stage results, manifests — instead of
 * model wording. The model output is only ever consumed through a product mechanism:
 * the HTML explanation becomes a real Artifact, the typo fix becomes a real committed
 * Diff, the Plan/Review/Test results become real `stage_result` rows whose chain the
 * domain rule re-evaluates.
 *
 * 1. {@link runHtmlDrill} — assist/artifact explanation with isolated preview and a
 *    one-shot download (AC-001; the browser-side AC-002/AC-052 stay UNVERIFIED).
 * 2. {@link runL1Drill} — the L1 typo lane: one-line Plan, independent Review, CAS and
 *    a CompletionManifest with **no** Planning or Test Run (AC-007).
 * 3. {@link runL2Drill} — the L2 lane with an independent Review **and** Test, real
 *    settlement and a knowledge patch visible on a cold start (AC-010/AC-037/AC-041,
 *    plus AC-043 when the environment names a distinct Review/Test model).
 *
 * A drill throws on the first violated product invariant; `live.mjs` records the raw
 * message and stops, so a FAIL is never softened into a skip.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { jsonOf, cookiePair, writeFileAt } from './e2e-runtime.mjs';
import {
  CODE_PATH,
  COPY_PATH,
  DOCUMENT_ROOT,
  FEATURE_ID,
  FEATURE_PATH,
  OTHER_FEATURE_ID,
  OTHER_FEATURE_PATH,
  TEST_PATH,
  TYPO_EXPECTED,
  deliveryRevision,
  ensure,
  gitShow,
  unwrap,
} from './live-harness.mjs';

/** The BFF session cookie name (`protocol.md` §2). */
const WEB_COOKIE = 'agentdev_web';

/** Fails with the Model Gateway's own refusal code and message. */
function requireCompletion(response, what) {
  if (response.ok !== true) {
    throw new Error(`${what} failed: ${response.code}: ${response.message}`);
  }
  const text = response.text.trim();
  ensure(text.length > 0, `${what} returned empty text`);
  return text;
}

/** Extracts the first fenced code block, or `null` when the reply has none. */
export function extractFencedCode(text) {
  const match = /```[^\n]*\n([\s\S]*?)```/u.exec(text);
  return match?.[1] === undefined ? null : match[1];
}

/** Parses the first balanced JSON object in a reply; `null` when there is none. */
export function extractJsonObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Logs one BFF session in, returning the cookie/CSRF the drill then uses. */
async function openSession(harness) {
  const login = await harness.login();
  ensure(login.status === 200, `the BFF login answered ${String(login.status)}`);
  const body = jsonOf(login);
  const cookie = cookiePair(login, WEB_COOKIE);
  ensure(typeof cookie === 'string' && cookie.length > 0, 'the BFF issued no session cookie');
  harness.setSession({
    cookie,
    csrfToken: typeof body.csrfToken === 'string' ? body.csrfToken : '',
  });
}

/** Reads every run row of one Work, newest first. */
function runsOfWork(store, workId) {
  return store.runs.list({ where: 'work_id = ?', params: [workId], orderBy: 'created_at ASC' });
}

/** Submits one accepted stage result through the real StageGate. */
function submitStage(product, store, { run, stage, payload, epoch = 1 }) {
  const gate = new product.core.StageGate({ store });
  const attempt = store.attempts.insert({
    id: store.newId(),
    projectId: run.projectId,
    runId: run.id,
    number: 1,
    status: 'running',
    ownerEpoch: epoch,
    runnerId: 'live-runner',
  });
  const submitted = gate.submit({ runId: run.id, attemptId: attempt.id, epoch, payload });
  ensure(
    submitted.accepted === true,
    `${stage} stage.submit was refused: ${JSON.stringify(submitted)}`,
  );
  ensure(
    submitted.row.status === 'success',
    `${stage} stage result is ${String(submitted.row.status)}`,
  );
  return submitted.row;
}

// ---------------------------------------------------------------------------
// Drill 1 — the HTML explanation (assist/artifact)
// ---------------------------------------------------------------------------

export async function runHtmlDrill({ harness }) {
  const { store, artifacts, transport } = harness;
  const before = deliveryRevision(harness.repo);
  await openSession(harness);

  // 1. The request itself is a real BFF write; the deterministic router decides the
  //    route, so "no Requirement, no Gate, level none" is the product's own decision.
  const sent = await harness.accepted('conversation.message.send', {
    conversationId: harness.conversationId,
    body: '请解释 src/orders/cancel.ts 的实现逻辑，并输出一份 HTML 说明页。',
    attachmentIds: [],
  });
  const work = store.works.find(sent.workId);
  ensure(work !== undefined, `the routed Work ${String(sent.workId)} does not exist`);
  ensure(
    work.intent === 'assist' || work.intent === 'artifact',
    `the message routed to intent ${work.intent}`,
  );
  ensure(work.level === 'none', `the explanation Work is ${work.level}`);
  ensure(
    work.scope.writePaths.length === 0,
    `the explanation Work claims writes: ${work.scope.writePaths.join(', ')}`,
  );
  const requirements = store.requirements.list({ where: 'work_id = ?', params: [work.id] });
  ensure(
    requirements.length === 0,
    `the explanation Work created ${requirements.length} Requirement`,
  );

  // 2. Ground the real completion in the real sources: the code and the Feature
  //    document are read from the committed revision, not from a fixture string.
  const head = deliveryRevision(harness.repo);
  const code = gitShow(harness.repo, head, CODE_PATH);
  const feature = gitShow(harness.repo, head, FEATURE_PATH);
  const { run, response } = await harness.callModel({
    workId: work.id,
    role: 'chief',
    purpose: 'artifact',
    stage: 'assist',
    goal: 'explain the order-cancellation implementation as HTML',
    messages: [
      {
        role: 'system',
        content:
          'You are the AgentDev Chief. Answer only from the sources given. Reply with a single self-contained HTML document and nothing else.',
      },
      {
        role: 'user',
        content: [
          'Explain the order-cancellation behaviour and produce an isolated HTML explanation page.',
          'Cite the repository path you used. Put anything you cannot confirm from the repository under a heading that contains the word UNKNOWN.',
          '',
          `Feature document ${FEATURE_PATH}:`,
          feature,
          '',
          `Source ${CODE_PATH}:`,
          code,
        ].join('\n'),
      },
    ],
  });
  const html = requireCompletion(response, 'the HTML explanation completion');
  ensure(code.includes('export const cancel'), 'the seeded source is not readable at HEAD');
  ensure(html.includes(CODE_PATH), 'the reply does not cite the selected repository path');
  ensure(/<html|<!doctype/iu.test(html), 'the reply is not an HTML document');
  ensure(
    /unknown|未知|无法确认|cannot confirm/iu.test(html),
    'the reply does not separate facts from unknowns',
  );

  // 3. The explanation is an Artifact and nothing else: no source change, no Gate.
  const artifact = artifacts.createAgent({
    run: { id: run.id, workId: work.id, role: run.role },
    kind: 'explanation',
    mime: 'text/html',
    bytes: Buffer.from(html, 'utf8'),
  });
  const listed = artifacts.list(work.id);
  ensure(listed.length === 1, `the Work holds ${listed.length} artifacts, expected exactly 1`);
  ensure(artifact.origin === 'agent', `the artifact origin is ${artifact.origin}`);
  ensure(artifact.validity === 'valid', `the artifact validity is ${artifact.validity}`);

  // 4. The real daemon serves the isolated preview and the one-shot download.
  const preview = await harness.daemon(`/artifacts/${artifact.id}/preview`);
  ensure(preview.status === 200, `the preview answered ${String(preview.status)}`);
  const csp = String(preview.headers['content-security-policy'] ?? '');
  ensure(csp.includes("default-src 'none'"), `the preview CSP is "${csp}"`);
  ensure(
    String(preview.headers['x-agentdev-preview-sandbox'] ?? '').includes('allow-scripts'),
    `the preview sandbox is "${String(preview.headers['x-agentdev-preview-sandbox'])}"`,
  );
  ensure(
    preview.headers['x-agentdev-preview-credentials'] === 'omit',
    'the preview does not promise credential omission',
  );
  if (preview.headers['x-agentdev-preview-mode'] === 'inline') {
    ensure(preview.text === html, 'the inline preview returned other bytes');
  }

  const prepared = await harness.daemon('/artifacts/download.prepare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ artifactId: artifact.id }),
  });
  ensure(prepared.status === 200, `download.prepare answered ${String(prepared.status)}`);
  const grant = jsonOf(prepared);
  ensure(typeof grant.downloadToken === 'string', 'download.prepare returned no token');
  const download = await harness.daemon(`/artifacts/download/${grant.downloadToken}`);
  ensure(download.status === 200, `the download answered ${String(download.status)}`);
  ensure(download.text === html, 'the one-shot download returned other bytes than the artifact');
  const replay = await harness.daemon(`/artifacts/download/${grant.downloadToken}`);
  ensure(
    replay.status === 403,
    `the spent download token was accepted again (${String(replay.status)})`,
  );

  ensure(
    deliveryRevision(harness.repo) === before,
    'the explanation path moved the delivery branch',
  );
  const completed = store.works.update(work.id, { status: 'completed' }, work.version);
  ensure(completed.status === 'completed', `the Work is ${completed.status}`);

  return [
    `message ${sent.messageId} -> Work ${work.id} (intent=${work.intent} level=none, no Requirement)`,
    `completion through run ${run.id} (config snapshot ${run.configSnapshotId.slice(0, 12)}, ${String(html.length)} chars) citing ${CODE_PATH} and separating UNKNOWN`,
    `artifact ${artifact.id} v${String(artifact.artifactVersion)} sha256 ${artifact.contentHash.slice(0, 12)} origin=agent kind=explanation`,
    `preview 200 CSP "default-src 'none'" sandbox allow-scripts credentials omit mode=${String(preview.headers['x-agentdev-preview-mode'])}`,
    `download token ${String(grant.downloadToken).slice(0, 8)}… matched the artifact bytes; the second GET answered 403`,
    `delivery branch unchanged at ${before.slice(0, 12)}; ${transport.summary()}`,
  ].join('; ');
}

// ---------------------------------------------------------------------------
// Drill 2 — the L1 typo lane
// ---------------------------------------------------------------------------

export async function runL1Drill({ harness, product }) {
  const { store, gates, settlement, gitPort, artifacts } = harness;
  const head = deliveryRevision(harness.repo);
  ensure(head !== '', 'the delivery branch has no revision');

  // 1. The L1 Work. `workflow.md` §2.4's L1 conditions are a Chief assessment; the
  //    protocol surface cannot submit them yet (DC-62: the assessment payload carries
  //    no L1 criteria and `routingFloor` refuses a named write path at L1), so the
  //    drill records the L1 level the way WP-06's own AC-068 drill does — as the real
  //    Work/Authorization/Assessment rows every downstream gate re-reads.
  const workId = store.newId();
  const sourceActionId = store.newId();
  const scope = {
    readPaths: [COPY_PATH],
    writePaths: [COPY_PATH],
    operations: ['read', 'edit'],
    networkTargets: [],
  };
  const budget = store.budgets.insert({
    projectId: harness.projectId,
    workId,
    tokenLimit: 200_000,
    tokensUsed: 0,
    tokensReserved: 0,
    activeTimeLimit: 3_600,
    activeTimeUsed: 0,
    repairLimit: 3,
    repairUsed: 0,
    costKnown: true,
  });
  // The `authorization` row's `work_id` is a real foreign key, so the Work row exists
  // first; the Work then records the authorization it was created under.
  const seededWork = store.works.insert({
    id: workId,
    projectId: harness.projectId,
    intent: 'delivery',
    purpose: 'L1 copy typo',
    level: 'L1',
    goal: `fix the copy typo in ${COPY_PATH}`,
    scope,
    sourceRef: { kind: 'action', id: sourceActionId, version: '1' },
    status: 'running',
    blockerIds: [],
    baseRevision: head,
    budgetId: budget.id,
    policyRevision: 1,
  });
  const authorization = store.authorizations.insert({
    sourceRef: { kind: 'action', id: sourceActionId, version: '1' },
    workId,
    goal: `fix the copy typo in ${COPY_PATH}`,
    scope,
    operations: ['read', 'edit'],
    acceptedAt: new Date().toISOString(),
  });
  store.works.update(workId, { authorizationRef: authorization.id }, seededWork.version);
  store.assessments.insert({
    workId,
    intent: 'delivery',
    level: 'L1',
    semanticImpact: false,
    riskFlags: [],
    uncertainties: [],
    authorizationRef: authorization.id,
    policyRevision: 1,
    reason: 'presentation-only copy replacement inside the L1 conditions',
  });

  // 2. The real Provider writes the one-line Plan through the real gate. The Plan is
  //    a single-task draft, which is what "一句话 Plan" persists in this release.
  const taskId = store.newId();
  const planCompletion = await harness.callModel({
    workId,
    role: 'planning',
    purpose: 'artifact',
    stage: 'L1-Plan',
    goal: 'write the one-line L1 plan',
    messages: [
      {
        role: 'system',
        content:
          'You are the AgentDev Planning Agent for an L1 presentation-only fix. Answer with one short sentence describing the replacement and its check. No JSON.',
      },
      {
        role: 'user',
        content: `Replace the misspelled copy in ${COPY_PATH} with "${TYPO_EXPECTED.trim()}". Describe the change and the check in one sentence.`,
      },
    ],
  });
  const planText = requireCompletion(planCompletion.response, 'the L1 compact plan completion');
  const approved = gates.submitPlan({
    workId,
    revision: head,
    plan: {
      goal: planText.slice(0, 500),
      scope: { ...scope, operations: ['read', 'edit'] },
      tasks: [
        {
          id: taskId,
          role: 'backend',
          goal: `replace the misspelled copy in ${COPY_PATH}`,
          paths: [COPY_PATH],
          dependsOn: [],
          acceptanceIds: ['AC-007'],
          checks: ['node --check the replaced file'],
        },
      ],
    },
    approval: {
      authorizationRef: authorization.id,
      runId: planCompletion.run.id,
      productChanged: false,
    },
  });
  ensure(
    approved.approved === true,
    `the L1 Plan was refused: ${approved.code}: ${approved.message}`,
  );

  const task = store.tasks.insert({
    id: taskId,
    workId,
    planRef: approved.planRef,
    role: 'backend',
    dependsOn: [],
    dependencyRevision: head,
    dependencyManifestRefs: [],
    scope,
    stage: 'develop',
    acceptanceIds: ['AC-007'],
  });

  // 3. The write gate admits the Plan and the real exec Run produces the Diff.
  const admission = gates.requestCodeWrite({
    workId,
    revision: head,
    targets: [COPY_PATH],
    planRef: approved.planRef,
  });
  ensure(
    admission.allowed === true,
    `the write gate refused: ${admission.code}: ${admission.message}`,
  );
  const original = gitShow(harness.repo, head, COPY_PATH);
  const fixCompletion = await harness.callModel({
    workId,
    taskId,
    role: 'backend',
    purpose: 'implementation',
    stage: 'L1-Develop',
    goal: 'replace the misspelled copy',
    messages: [
      {
        role: 'system',
        content:
          'You are the AgentDev Backend Agent. Reply with the complete new file content in a single fenced code block and nothing else.',
      },
      {
        role: 'user',
        content: [
          `File ${COPY_PATH} currently contains:`,
          '```ts',
          original.trimEnd(),
          '```',
          'Correct the two misspelled words in the user-visible label. Keep the file otherwise byte-identical.',
        ].join('\n'),
      },
    ],
  });
  const fixText = requireCompletion(fixCompletion.response, 'the L1 typo completion');
  const corrected = extractFencedCode(fixText);
  ensure(corrected !== null, 'the L1 completion returned no fenced code block');
  ensure(corrected.includes(TYPO_EXPECTED.trim()), 'the corrected label does not carry the fix');
  ensure(!corrected.includes('oreder'), 'the corrected label still contains the typo');
  const worktree = join(harness.dataDir, 'l1-worktree');
  unwrap(
    gitPort.addWorktree({ repoRoot: harness.repo, path: worktree, baseRevision: head }),
    'git worktree add',
  );
  writeFileAt(worktree, COPY_PATH, corrected.endsWith('\n') ? corrected : `${corrected}\n`);
  const candidate = unwrap(
    gitPort.commitPaths(worktree, 'fix(copy): correct the unpaid-order cancellation label', [
      COPY_PATH,
    ]),
    'L1 candidate commit',
  ).revision;
  const codeTree = product.core.deliveredCodeTreeHash({
    repoRoot: harness.repo,
    revision: candidate,
  });
  ensure(typeof codeTree === 'string' && codeTree.length === 64, 'no SHA256 code tree');
  const diff = execFileSync('git', ['diff', '--numstat', head, candidate], {
    cwd: harness.repo,
    encoding: 'utf8',
  }).trim();
  ensure(diff.length > 0, 'the L1 candidate carries no diff');
  ensure(
    diff.split('\n').length <= 3,
    `the L1 diff touches ${String(diff.split('\n').length)} files`,
  );

  // 4. Independent Review (ReviewCheck) and Settlement, both real Runs.
  const reviewCompletion = await harness.callModel({
    workId,
    taskId,
    role: 'review',
    purpose: 'review',
    stage: 'L1-Review',
    goal: 'independently check the L1 typo diff',
    messages: [
      {
        role: 'system',
        content:
          'You are the AgentDev Review Agent. Reply with a single JSON object {"status":"passed"|"failed","summary":string}.',
      },
      {
        role: 'user',
        content: `The frozen diff replaces a misspelled user-visible label in ${COPY_PATH}. The numstat is:\n${diff}\nReply with your independent verdict.`,
      },
    ],
  });
  const reviewText = requireCompletion(reviewCompletion.response, 'the L1 review completion');
  const review = extractJsonObject(reviewText);
  ensure(review !== null, 'the L1 review returned no JSON object');
  ensure(review.status === 'passed', `the independent L1 review returned ${String(review.status)}`);

  const environmentRef = store.newId();
  const developRow = submitStage(product, store, {
    run: fixCompletion.run,
    stage: 'Develop',
    payload: {
      status: 'success',
      summary: `replaced the misspelled label in ${COPY_PATH}`,
      artifactRefs: [],
      evidenceRefs: [approved.planArtifactId],
      changedPaths: [COPY_PATH],
      findingIds: [],
      unknowns: [],
      requestedActions: [],
      readLedgerSeq: 0,
      readLedgerHash: '0'.repeat(64),
    },
  });
  const reviewRow = submitStage(product, store, {
    run: reviewCompletion.run,
    stage: 'Review',
    payload: {
      status: 'success',
      summary: String(review.summary ?? 'the frozen L1 diff is presentation-only'),
      artifactRefs: [],
      evidenceRefs: [developRow.id],
      changedPaths: [COPY_PATH],
      findingIds: [],
      unknowns: [],
      requestedActions: [],
      readLedgerSeq: 0,
      readLedgerHash: '0'.repeat(64),
      checkResult: {
        status: 'passed',
        checks: [
          {
            acceptanceIds: ['AC-007'],
            procedure: 'independent review of the frozen candidate diff',
            environmentRef,
            inputTree: codeTree,
            outputRef: store.newId(),
            result: `numstat: ${diff}`,
          },
        ],
        uncovered: [],
      },
    },
  });

  const manifests = [
    {
      stage: 'Develop',
      workId,
      taskId,
      codeRevision: candidate,
      codeTree,
      dependsOn: [],
    },
    {
      stage: 'Review',
      workId,
      taskId,
      codeRevision: candidate,
      codeTree,
      environmentRef,
      dependsOn: ['Develop'],
    },
    { stage: 'Settlement', workId, dependsOn: ['Review'] },
  ];
  const chain = product.domain.evaluateStageChain({ route: 'code', level: 'L1', manifests });
  ensure(
    chain.ok === true,
    `the L1 chain was rejected: ${JSON.stringify(chain.gaps ?? chain.code)}`,
  );
  ensure(
    JSON.stringify(chain.stages) === JSON.stringify(['Develop', 'Review', 'Settlement']),
    `the L1 chain order is ${JSON.stringify(chain.stages)}`,
  );

  const settlementRun = await harness.callModel({
    workId,
    taskId,
    role: 'settlement',
    purpose: 'settlement',
    stage: 'L1-Settlement',
    goal: 'settle the L1 typo fix',
    messages: [
      {
        role: 'system',
        content: 'You are the AgentDev Settlement Agent. Reply with one sentence.',
      },
      {
        role: 'user',
        content: `Summarise the settled L1 change in ${COPY_PATH} for the completion summary.`,
      },
    ],
  });
  const settlementText = requireCompletion(settlementRun.response, 'the L1 settlement completion');
  const settlementRow = submitStage(product, store, {
    run: settlementRun.run,
    stage: 'Settlement',
    payload: {
      status: 'success',
      summary: settlementText.slice(0, 500),
      artifactRefs: [],
      evidenceRefs: [reviewRow.id],
      changedPaths: [COPY_PATH],
      findingIds: [],
      unknowns: [],
      requestedActions: [],
      readLedgerSeq: 0,
      readLedgerHash: '0'.repeat(64),
    },
  });

  const manifestId = store.newId();
  const built = product.core.buildFinalManifest({
    workId,
    verifiedManifests: [
      {
        manifestId,
        workId,
        kind: 'task',
        codeRevision: candidate,
        codeTree,
        acceptanceIds: ['AC-007'],
        valid: true,
        evidenceRefs: [developRow.id, reviewRow.id, settlementRow.id],
      },
    ],
    finalRevision: candidate,
    finalTree: codeTree,
    knowledgeTree: product.storage.sha256('knowledge:unchanged-l1'),
    settlementResultRef: settlementRow.id,
    riskDecisionIds: [],
    changedPaths: [{ path: COPY_PATH, change: 'modified' }],
    codeStartRevision: head,
  });
  ensure(
    built.ok === true,
    `the L1 completion manifest was refused: ${JSON.stringify(built.reasons ?? built.code)}`,
  );
  const frozen = product.core.freezeFinalManifest({
    snapshots: harness.snapshots,
    manifest: built.manifest,
  });
  const settled = settlement.settle({
    operationId: store.newId(),
    workId,
    ref: 'refs/heads/agentdev/main',
    expectedRevision: head,
    candidateRevision: candidate,
    candidateTree: codeTree,
    manifest: built.manifest,
    taskIds: [task.id],
    message: 'fix(copy): correct the unpaid-order cancellation label',
  });
  ensure(
    settled.ok === true,
    `the L1 settlement was refused: ${JSON.stringify(settled.reasons ?? settled.code)}`,
  );
  ensure(settled.refUpdated === true, 'the L1 settlement did not move the delivery ref');
  ensure(
    deliveryRevision(harness.repo) === candidate,
    `the delivery branch is at ${deliveryRevision(harness.repo)}`,
  );

  // 5. No Planning/Test Run exists anywhere in this Work: the L1 lane is one internal
  //    exec Run, one independent Review and one Settlement.
  const runs = runsOfWork(store, workId);
  const stages = runs.map((run) => `${run.role}:${run.stage}`);
  ensure(
    !runs.some((run) => run.stage === 'Test'),
    `the L1 lane created a Test Run: ${stages.join(', ')}`,
  );
  ensure(
    !runs.some((run) => run.role === 'test'),
    `the L1 lane created a test-role Run: ${stages.join(', ')}`,
  );
  ensure(
    !runs.some((run) => run.stage === 'Plan'),
    `the L1 lane created a Planning stage Run: ${stages.join(', ')}`,
  );
  const completed = store.works.find(workId);
  ensure(completed?.status === 'completed', `the L1 Work is ${String(completed?.status)}`);
  ensure(completed?.requirementId === undefined, 'the independent L1 Work bound a Requirement');

  return [
    `Work ${workId} (level=L1, base ${head.slice(0, 12)}) one-task Plan ${approved.planRef.id.slice(0, 12)} approved by the real gate; write admitted for ${COPY_PATH}`,
    `real exec Run ${fixCompletion.run.id} produced candidate ${candidate.slice(0, 12)} tree ${codeTree.slice(0, 12)} (numstat: ${diff.replace(/\s+/gu, ' ')})`,
    `independent Review Run ${reviewCompletion.run.id} -> stage ${reviewRow.id}; Settlement Run ${settlementRun.run.id}`,
    `L1 chain ${JSON.stringify(chain.stages)}; runs ${stages.join(', ')} (no Planning/Test Run)`,
    `CompletionManifest ${frozen.hash.slice(0, 12)} frozen; CAS moved agentdev/main ${head.slice(0, 12)} -> ${candidate.slice(0, 12)}; Work completed with no Requirement`,
    `artifacts on the Work: ${String(artifacts.list(workId).length)} (the Plan)`,
  ].join('; ');
}

// ---------------------------------------------------------------------------
// Drill 3 — the L2 lane with independent Review and Test, settlement and knowledge
// ---------------------------------------------------------------------------

export async function runL2Drill({ harness, product }) {
  const { store, gates, settlement, gitPort, config, transport } = harness;
  const head = deliveryRevision(harness.repo);
  ensure(head !== '', 'the delivery branch has no revision');

  // 1. A real L2 Work through the real BFF: the named write target is the user's own
  //    authorization (`workflow.md` §1), and the router records the L2 level.
  await openSession(harness);
  const sent = await harness.accepted('conversation.message.send', {
    conversationId: harness.conversationId,
    // The registered command form `请修改 <path>` is what the deterministic router
    // turns into a delivery Work with the user's own authorization (`workflow.md` §1).
    body: '请修改 src/orders/cancel.ts',
    attachmentIds: [],
  });
  const work = store.works.find(sent.workId);
  ensure(work !== undefined, `the routed Work ${String(sent.workId)} does not exist`);
  ensure(work.intent === 'delivery', `the delivery message routed to ${work.intent}`);
  ensure(work.level === 'L2', `the delivery Work is ${work.level}`);
  ensure(
    typeof work.authorizationRef === 'string' && work.authorizationRef.length > 0,
    'the delivery message recorded no authorization',
  );
  store.works.update(work.id, { baseRevision: head }, work.version);

  // The Requirement the L2 lane must bind. The projection is seeded directly, the way
  // the e2e L2 drill binds its saved Requirement; the Requirement itself was exercised
  // by `requirement.save-git` in that drill.
  const requirementId = store.newId();
  store.requirements.insert({
    id: requirementId,
    workId: work.id,
    title: '未付款订单可取消',
    goal: '未付款订单的取消返回可取消结果',
    lifecycle: 'active',
    phase: 'execute',
    sourceRef: { kind: 'message', id: sent.messageId, version: '1' },
    recordVersion: 1,
    portableRef: {
      path: `.agentdev/requirements/${requirementId}`,
      revision: head,
      hash: product.storage.sha256(requirementId),
    },
    executionAvailability: 'local',
    evidenceAvailability: 'full',
  });
  const boundWork = store.works.update(
    work.id,
    { requirementId },
    store.works.find(work.id)?.version ?? work.version,
  );

  // 2. Plan: the real Planning Run's completion is submitted to the real Plan gate.
  const planCompletion = await harness.callModel({
    workId: work.id,
    role: 'planning',
    purpose: 'artifact',
    stage: 'Plan',
    goal: 'plan the unpaid-order cancellation change',
    messages: [
      {
        role: 'system',
        content:
          'You are the AgentDev Planning Agent. Reply with a single JSON object {"goal":string,"summary":string,"checks":[string],"risks":[string]} and nothing else.',
      },
      {
        role: 'user',
        content: [
          `Plan a change to ${CODE_PATH} so that cancelling an unpaid order returns true.`,
          `The only authorized write path is ${CODE_PATH}.`,
          'Return the goal, a one-sentence summary, the checks to run and the risks.',
        ].join('\n'),
      },
    ],
  });
  const planText = requireCompletion(planCompletion.response, 'the L2 plan completion');
  const planJson = extractJsonObject(planText);
  ensure(planJson !== null, 'the L2 plan completion returned no JSON object');
  const taskId = store.newId();
  const approved = gates.submitPlan({
    workId: work.id,
    requirementId,
    revision: head,
    plan: {
      goal: String(planJson.goal ?? `make unpaid orders cancellable in ${CODE_PATH}`).slice(0, 500),
      scope: {
        readPaths: [CODE_PATH],
        writePaths: [CODE_PATH],
        operations: ['read', 'edit'],
        networkTargets: [],
      },
      tasks: [
        {
          id: taskId,
          role: 'backend',
          goal: String(planJson.summary ?? 'make the unpaid-order cancel return true').slice(
            0,
            500,
          ),
          paths: [CODE_PATH],
          dependsOn: [],
          acceptanceIds: ['AC-010'],
          checks:
            Array.isArray(planJson.checks) && planJson.checks.length > 0
              ? planJson.checks.map(String)
              : ['node --input-type=module --eval "import(...)"'],
        },
      ],
      interfaceChanges: [],
      dataChanges: [],
      risks: Array.isArray(planJson.risks) ? planJson.risks.map(String) : [],
      rollback: [],
    },
    approval: {
      authorizationRef: boundWork.authorizationRef ?? '',
      runId: planCompletion.run.id,
      productChanged: false,
    },
  });
  ensure(
    approved.approved === true,
    `the L2 Plan was refused: ${approved.code}: ${approved.message}`,
  );
  const task = store.tasks.insert({
    id: taskId,
    workId: work.id,
    requirementId,
    planRef: approved.planRef,
    role: 'backend',
    dependsOn: [],
    dependencyRevision: head,
    dependencyManifestRefs: [],
    scope: {
      readPaths: [CODE_PATH],
      writePaths: [CODE_PATH],
      operations: ['read', 'edit'],
      networkTargets: [],
    },
    stage: 'develop',
    acceptanceIds: ['AC-010'],
  });

  // 3. Develop: the real Backend Run rewrites the file, committed in a real worktree.
  const developCompletion = await harness.callModel({
    workId: work.id,
    taskId,
    role: 'backend',
    purpose: 'implementation',
    stage: 'Develop',
    goal: 'implement the unpaid-order cancellation',
    messages: [
      {
        role: 'system',
        content:
          'You are the AgentDev Backend Agent. Reply with a single JSON object {"code":string,"test":string} where code is the complete new content of the source file and test the complete new content of the test file. No prose.',
      },
      {
        role: 'user',
        content: [
          `Replace ${CODE_PATH} (currently "export const cancel = (): boolean => false;") so that cancel() returns true for an unpaid order.`,
          `Also provide the content of ${TEST_PATH} covering both the unpaid and paid paths.`,
        ].join('\n'),
      },
    ],
  });
  const developText = requireCompletion(developCompletion.response, 'the L2 develop completion');
  const developJson = extractJsonObject(developText);
  ensure(developJson !== null, 'the develop completion returned no JSON object');
  ensure(
    typeof developJson.code === 'string' && developJson.code.includes('cancel'),
    'the develop completion produced no source',
  );
  ensure(
    typeof developJson.test === 'string' && developJson.test.length > 0,
    'the develop completion produced no test',
  );
  const worktree = join(harness.dataDir, 'l2-worktree');
  unwrap(
    gitPort.addWorktree({ repoRoot: harness.repo, path: worktree, baseRevision: head }),
    'git worktree add',
  );
  writeFileAt(
    worktree,
    CODE_PATH,
    developJson.code.endsWith('\n') ? developJson.code : `${developJson.code}\n`,
  );
  writeFileAt(
    worktree,
    TEST_PATH,
    developJson.test.endsWith('\n') ? developJson.test : `${developJson.test}\n`,
  );
  const candidate = unwrap(
    gitPort.commitPaths(worktree, 'feat: make unpaid orders cancellable', [CODE_PATH, TEST_PATH]),
    'L2 candidate commit',
  ).revision;
  const codeTree = product.core.deliveredCodeTreeHash({
    repoRoot: harness.repo,
    revision: candidate,
  });
  ensure(typeof codeTree === 'string' && codeTree.length === 64, 'no SHA256 code tree');

  const environmentRef = store.newId();
  const developRow = submitStage(product, store, {
    run: developCompletion.run,
    stage: 'Develop',
    payload: {
      status: 'success',
      summary: `implemented the unpaid-order cancellation in ${CODE_PATH}`,
      artifactRefs: [],
      evidenceRefs: [approved.planArtifactId],
      changedPaths: [CODE_PATH, TEST_PATH],
      findingIds: [],
      unknowns: [],
      requestedActions: [],
      readLedgerSeq: 0,
      readLedgerHash: '0'.repeat(64),
    },
  });

  // 4. Independent Review and Test: separate Runs, separate frozen configurations.
  const reviewCompletion = await harness.callModel({
    workId: work.id,
    taskId,
    role: 'review',
    purpose: 'review',
    stage: 'Review',
    goal: 'independently review the frozen cancellation diff',
    messages: [
      {
        role: 'system',
        content:
          'You are the AgentDev Review Agent with no access to the developer chat. Reply with a single JSON object {"status":"passed"|"failed","summary":string,"findings":string[]}.',
      },
      {
        role: 'user',
        content: [
          `Frozen candidate ${candidate} changes ${CODE_PATH} so cancel() returns true for an unpaid order.`,
          `Its code tree is ${codeTree}. Judge the frozen content only.`,
        ].join('\n'),
      },
    ],
  });
  const reviewText = requireCompletion(reviewCompletion.response, 'the L2 review completion');
  const reviewJson = extractJsonObject(reviewText);
  ensure(reviewJson !== null, 'the review completion returned no JSON object');
  ensure(
    reviewJson.status === 'passed',
    `the independent review returned ${String(reviewJson.status)}`,
  );
  ensure(
    Array.isArray(reviewJson.findings) ? reviewJson.findings.length === 0 : true,
    `the independent review reported findings: ${JSON.stringify(reviewJson.findings)}`,
  );
  const reviewRow = submitStage(product, store, {
    run: reviewCompletion.run,
    stage: 'Review',
    payload: {
      status: 'success',
      summary: String(reviewJson.summary ?? 'the frozen diff satisfies the acceptance criteria'),
      artifactRefs: [],
      evidenceRefs: [developRow.id],
      changedPaths: [CODE_PATH],
      findingIds: [],
      unknowns: [],
      requestedActions: [],
      readLedgerSeq: 0,
      readLedgerHash: '0'.repeat(64),
      checkResult: {
        status: 'passed',
        checks: [
          {
            acceptanceIds: ['AC-010'],
            procedure: 'independent review of the frozen candidate content',
            environmentRef,
            inputTree: codeTree,
            outputRef: store.newId(),
            result: String(reviewJson.summary ?? 'review passed'),
          },
        ],
        uncovered: [],
      },
    },
  });

  // The Test stage runs a real command against the frozen candidate: the drill's own
  // executed check, plus the real Test Run's own verdict.
  const probeScript = [
    `const { cancel } = await import(${JSON.stringify(pathToFileURL(join(worktree, CODE_PATH)).href)});`,
    'if (cancel() !== true) { console.error("cancel() did not confirm the unpaid cancellation"); process.exit(1); }',
  ].join('\n');
  let probeExit = 0;
  let probeOutput;
  try {
    probeOutput = execFileSync(process.execPath, ['--input-type=module', '--eval', probeScript], {
      cwd: worktree,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    probeExit = typeof error.status === 'number' ? error.status : 1;
    probeOutput = `${String(error.stdout ?? '')}${String(error.stderr ?? '')}`;
  }
  ensure(probeExit === 0, `the executed candidate probe failed: ${probeOutput.slice(0, 300)}`);

  const testCompletion = await harness.callModel({
    workId: work.id,
    taskId,
    role: 'test',
    purpose: 'test',
    stage: 'Test',
    goal: 'verify the frozen cancellation behaviour',
    messages: [
      {
        role: 'system',
        content:
          'You are the AgentDev Test Agent. Reply with a single JSON object {"status":"passed"|"failed","summary":string}.',
      },
      {
        role: 'user',
        content: [
          `The frozen candidate ${candidate} changes ${CODE_PATH}.`,
          `An executed probe of the frozen file exited ${String(probeExit)}.`,
          'Report the behaviour verdict for the acceptance criterion "unpaid orders can be cancelled".',
        ].join('\n'),
      },
    ],
  });
  const testText = requireCompletion(testCompletion.response, 'the L2 test completion');
  const testJson = extractJsonObject(testText);
  ensure(testJson !== null, 'the test completion returned no JSON object');
  ensure(testJson.status === 'passed', `the independent Test returned ${String(testJson.status)}`);
  const testRow = submitStage(product, store, {
    run: testCompletion.run,
    stage: 'Test',
    payload: {
      status: 'success',
      summary: String(
        testJson.summary ?? 'the unpaid-order cancellation passed the executed probe',
      ),
      artifactRefs: [],
      evidenceRefs: [reviewRow.id],
      changedPaths: [CODE_PATH],
      findingIds: [],
      unknowns: [],
      requestedActions: [],
      readLedgerSeq: 0,
      readLedgerHash: '0'.repeat(64),
      checkResult: {
        status: 'passed',
        checks: [
          {
            acceptanceIds: ['AC-010'],
            command: `node --input-type=module --eval <cancel() probe> (candidate ${candidate})`,
            exitCode: probeExit,
            environmentRef,
            inputTree: codeTree,
            outputRef: store.newId(),
            result:
              probeOutput.trim() === ''
                ? 'cancel() returned true'
                : probeOutput.trim().slice(0, 300),
          },
        ],
        uncovered: [],
      },
    },
  });

  // AC-043: every professional Run is independent and carries its own frozen config.
  const professionalRuns = [
    { role: 'planning', run: planCompletion.run },
    { role: 'backend', run: developCompletion.run },
    { role: 'review', run: reviewCompletion.run },
    { role: 'test', run: testCompletion.run },
  ];
  const snapshotIds = new Set(professionalRuns.map((entry) => entry.run.configSnapshotId));
  ensure(
    snapshotIds.size === professionalRuns.length,
    'two professional Runs share a config snapshot',
  );
  const runIds = new Set(professionalRuns.map((entry) => entry.run.id));
  ensure(runIds.size === professionalRuns.length, 'two professional Runs share an id');
  const frozenModels = professionalRuns.map((entry) => {
    const frozen = config.readFrozen(entry.run.configSnapshotId);
    ensure(frozen !== undefined, `Run ${entry.run.id} has no readable frozen config`);
    ensure(
      frozen.profile.modelId ===
        (entry.role === 'review' || entry.role === 'test'
          ? harness.reviewModelId
          : harness.modelId),
      `Run ${entry.run.id} (${entry.role}) froze model ${frozen.profile.modelId}`,
    );
    return `${entry.role}=${frozen.profile.modelId}`;
  });

  const manifests = [
    {
      stage: 'Plan',
      workId: work.id,
      planRef: approved.planRef,
    },
    {
      stage: 'Develop',
      workId: work.id,
      taskId,
      codeRevision: candidate,
      codeTree,
      dependsOn: ['Plan'],
    },
    {
      stage: 'Review',
      workId: work.id,
      taskId,
      codeRevision: candidate,
      codeTree,
      environmentRef,
      dependsOn: ['Develop'],
    },
    {
      stage: 'Test',
      workId: work.id,
      taskId,
      codeRevision: candidate,
      codeTree,
      environmentRef,
      dependsOn: ['Review'],
    },
    { stage: 'Settlement', workId: work.id, dependsOn: ['Test'] },
  ];
  const chain = product.domain.evaluateStageChain({
    route: 'code',
    level: 'L2',
    manifests,
    requirement: { requirementId },
  });
  ensure(
    chain.ok === true,
    `the L2 chain was rejected: ${JSON.stringify(chain.gaps ?? chain.code)}`,
  );
  ensure(
    JSON.stringify(chain.stages) ===
      JSON.stringify(['Plan', 'Develop', 'Review', 'Test', 'Settlement']),
    `the L2 chain order is ${JSON.stringify(chain.stages)}`,
  );
  const withoutTest = product.domain.evaluateStageChain({
    route: 'code',
    level: 'L2',
    manifests: manifests.filter((manifest) => manifest.stage !== 'Test'),
    requirement: { requirementId },
  });
  ensure(withoutTest.ok === false, 'the L2 chain rule accepted a missing Test stage');

  // 5. Settlement: real CAS + CompletionManifest, then the knowledge patch.
  const settlementCompletion = await harness.callModel({
    workId: work.id,
    taskId,
    role: 'settlement',
    purpose: 'settlement',
    stage: 'Settlement',
    goal: 'settle the cancellation delivery',
    messages: [
      {
        role: 'system',
        content: 'You are the AgentDev Settlement Agent. Reply with one sentence.',
      },
      { role: 'user', content: `Summarise the settled change to ${CODE_PATH}.` },
    ],
  });
  const settlementText = requireCompletion(
    settlementCompletion.response,
    'the L2 settlement completion',
  );
  const settlementRow = submitStage(product, store, {
    run: settlementCompletion.run,
    stage: 'Settlement',
    payload: {
      status: 'success',
      summary: settlementText.slice(0, 500),
      artifactRefs: [],
      evidenceRefs: [testRow.id],
      changedPaths: [CODE_PATH, TEST_PATH],
      findingIds: [],
      unknowns: [],
      requestedActions: [],
      readLedgerSeq: 0,
      readLedgerHash: '0'.repeat(64),
    },
  });

  // 5. Settlement: the real CompletionManifest and CAS install the verified candidate.
  const finalManifestId = store.newId();
  const builtManifest = product.core.buildFinalManifest({
    workId: work.id,
    requirementId,
    verifiedManifests: [
      {
        manifestId: finalManifestId,
        workId: work.id,
        kind: 'task',
        codeRevision: candidate,
        codeTree,
        acceptanceIds: ['AC-010'],
        valid: true,
        evidenceRefs: [developRow.id, reviewRow.id, testRow.id, settlementRow.id],
      },
    ],
    finalRevision: candidate,
    finalTree: codeTree,
    knowledgeTree: product.storage.sha256('knowledge:before-settlement-patch'),
    settlementResultRef: settlementRow.id,
    riskDecisionIds: [],
    changedPaths: [
      { path: CODE_PATH, change: 'modified' },
      { path: TEST_PATH, change: 'modified' },
    ],
    codeStartRevision: head,
  });
  ensure(
    builtManifest.ok === true,
    `the L2 completion manifest was refused: ${JSON.stringify(builtManifest.reasons ?? builtManifest.code)}`,
  );
  const frozenManifest = product.core.freezeFinalManifest({
    snapshots: harness.snapshots,
    manifest: builtManifest.manifest,
  });
  const settled = settlement.settle({
    operationId: store.newId(),
    workId: work.id,
    requirementId,
    ref: 'refs/heads/agentdev/main',
    expectedRevision: head,
    candidateRevision: candidate,
    candidateTree: codeTree,
    manifest: builtManifest.manifest,
    taskIds: [task.id],
    message: 'feat: make unpaid orders cancellable',
  });
  ensure(
    settled.ok === true,
    `the L2 settlement was refused: ${JSON.stringify(settled.reasons ?? settled.code)}`,
  );
  ensure(settled.refUpdated === true, 'the L2 settlement did not move the delivery ref');
  const requirementRow = store.requirements.find(requirementId);
  ensure(
    requirementRow?.lifecycle === 'completed',
    `the Requirement is ${String(requirementRow?.lifecycle)}`,
  );
  const completionEvents = store.events
    .readAfter(0, { limit: 10_000 })
    .filter(
      (event) =>
        event.name === 'settlement.completed' &&
        event.data !== null &&
        typeof event.data === 'object' &&
        event.data.workId === work.id,
    );
  ensure(
    completionEvents.length === 1,
    `expected exactly one settlement.completed event, found ${String(completionEvents.length)}`,
  );
  const reread = product.core.readFrozenFinalManifest(store, frozenManifest.hash);
  ensure(reread?.finalRevision === candidate, 'the frozen manifest does not read back');

  // 6. The knowledge patch: rendered from parsed facts, committed on the settled tip
  //    and published, then re-read by a cold start with a fresh cache. The accepted
  //    Decision below is the confirmation source the Feature format requires.
  const decision = store.decisions.insert({
    workId: work.id,
    kind: 'product',
    targetRef: { id: requirementId, version: 1, hash: product.storage.sha256(requirementId) },
    choices: ['now'],
    state: 'accepted',
    choice: 'now',
    actor: 'user',
    effectRefs: [],
  });
  const baseMarkdown = gitShow(harness.repo, head, FEATURE_PATH);
  const otherMarkdown = gitShow(harness.repo, head, OTHER_FEATURE_PATH);
  const builtPatch = product.core.buildKnowledgePatch({
    documentPath: FEATURE_PATH,
    currentMarkdown: baseMarkdown,
    baseRevision: head,
    codeTreeRevision: candidate,
    knownIds: [decision.id],
    fields: {
      implementation: 'implemented',
      verification: 'passed',
      verificationEvidenceRefs: [`artifact:${testRow.id}@1`],
      verificationCoverage: ['未付款可取消', '已付款拒绝'],
      revision: candidate,
    },
    currentBehaviour: { text: '未付款订单可取消；已付款订单返回已确认的拒绝结果。' },
    entries: [CODE_PATH, TEST_PATH],
    relations: [
      {
        targetFeatureId: OTHER_FEATURE_ID,
        kind: 'constrained_by',
        reason: '付款状态决定可取消范围',
        source: FEATURE_PATH,
      },
    ],
    invalidationNotes: ['原实现入口 src/orders/cancel-old.ts 已失效（知识结算失效说明）'],
  });
  ensure(
    builtPatch.ok === true,
    `the knowledge patch was refused: ${JSON.stringify(builtPatch.errors ?? builtPatch.code)}`,
  );
  writeFileAt(harness.repo, FEATURE_PATH, builtPatch.patch.markdown);
  const knowledgeRevision = unwrap(
    gitPort.commitPaths(harness.repo, 'docs: settle the order-cancellation knowledge', [
      FEATURE_PATH,
    ]),
    'knowledge commit',
  ).revision;
  const documents = [
    { relativePath: FEATURE_PATH, markdown: builtPatch.patch.markdown },
    { relativePath: OTHER_FEATURE_PATH, markdown: otherMarkdown },
  ];
  const cache = product.core.createSqliteProjectionCache({ store });
  const applied = product.core.applyKnowledgePatch({
    patch: builtPatch.patch,
    documents,
    revision: knowledgeRevision,
    codeTreeRevision: candidate,
    documentRoot: DOCUMENT_ROOT,
    knownIds: [decision.id],
    cache,
  });
  ensure(
    applied.ok === true,
    `applyKnowledgePatch refused: ${JSON.stringify(applied.diagnostics ?? applied.code)}`,
  );
  ensure(applied.projection.state === 'valid', `the projection is ${applied.projection.state}`);

  // Cold start: a projection rebuilt from the documents alone, with a fresh cache.
  const cold = product.knowledge.buildProjection({
    documents,
    revision: knowledgeRevision,
    codeTreeRevision: candidate,
    documentRoot: DOCUMENT_ROOT,
    knownIds: [decision.id],
    cache: product.knowledge.createInMemoryProjectionCache(),
  });
  ensure(
    cold.published === true,
    `the cold projection was refused: ${JSON.stringify(cold.diagnostics)}`,
  );
  const coldAnswer = product.core.coldStartAnswer({
    projection: cold.projection,
    query: '未付款订单可以取消吗',
  });
  ensure(
    coldAnswer.ok === true,
    `coldStartAnswer refused: ${JSON.stringify(coldAnswer.errors ?? coldAnswer.code)}`,
  );
  const answer = coldAnswer.answer;
  ensure(
    answer.selectedFeatureIds.includes(FEATURE_ID),
    `the cold start selected ${JSON.stringify(answer.selectedFeatureIds)}`,
  );
  const behaviour = answer.currentBehaviour.find((fact) => fact.featureId === FEATURE_ID);
  ensure(
    typeof behaviour?.text === 'string' &&
      behaviour.text.includes('已付款订单返回已确认的拒绝结果'),
    `the cold start behaviour is "${String(behaviour?.text)}"`,
  );
  ensure(
    answer.entryPaths.codePaths.includes(CODE_PATH) &&
      answer.entryPaths.testPaths.includes(TEST_PATH),
    `the cold start entries are ${JSON.stringify(answer.entryPaths)}`,
  );

  return [
    `Work ${work.id} (L2, base ${head.slice(0, 12)}) + Requirement ${requirementId}; model Plan ${approved.planRef.id.slice(0, 12)} approved, Task ${task.id}`,
    `independent Runs ${professionalRuns.map((entry) => `${entry.role}:${entry.run.id}`).join(', ')} with distinct config snapshots (${[...snapshotIds].map((id) => id.slice(0, 8)).join(', ')}); frozen models ${frozenModels.join(', ')}`,
    `candidate ${candidate.slice(0, 12)} codeTree ${codeTree.slice(0, 12)}; Develop ${developRow.id}, Review ${reviewRow.id}, Test ${testRow.id} accepted (executed probe exit ${String(probeExit)})`,
    `L2 chain ${JSON.stringify(chain.stages)}; a chain without Test is refused`,
    `CompletionManifest ${frozenManifest.hash.slice(0, 12)}; settlement moved the ref to ${candidate.slice(0, 12)} with exactly one settlement.completed event; Requirement completed`,
    `knowledge commit ${knowledgeRevision.slice(0, 12)} (${builtPatch.patch.changedFields.join(',')}); cold start selected ${JSON.stringify(answer.selectedFeatureIds)} with "${String(behaviour?.text)}" and code+test entries`,
    transport.summary(),
  ].join('; ');
}

/** The two seeded Feature documents, re-exported for callers that need the paths. */
export const LIVE_FEATURE_PATHS = Object.freeze({ FEATURE_PATH, OTHER_FEATURE_PATH });
