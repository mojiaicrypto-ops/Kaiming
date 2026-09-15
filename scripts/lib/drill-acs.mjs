/**
 * Single source of truth for "which AC needs which release drill".
 *
 * WP-10 review round 1 (W10R1-10) found that `scripts/live.mjs` declared
 * `DRILL_ACS` for AC-007/010/037/041 while `scripts/lib/acceptance-registry.mjs`
 * registered a different set, so those ACs' real-provider gap was invisible in the
 * acceptance summary. Both the drills (`scripts/e2e.mjs`, `scripts/live.mjs`) and the
 * aggregator now import this module, so the two lists cannot drift again.
 *
 * `RESIDUAL_GAPS` is the *accepted-gap register*: for each AC whose full
 * Given/When/Then needs an environment this release deliberately does not ship
 * (a real browser), an input this environment does not have (a real Provider, a
 * distinct Review/Test model) or a recorded product shortfall, it names the missing
 * input. `closedBy` names the drill that can close the gap (its per-AC row must be
 * `PASS`); a gap without `closedBy` is a product shortfall no drill can close. The
 * aggregator downgrades a registered AC to UNVERIFIED until its gap is closed, and
 * only accepts that UNVERIFIED while the named condition still holds — see
 * `scripts/acceptance.mjs`. WP-12 T7a gave the five browser ACs `closedBy:
 * 'pnpm test:e2e'`, because `pnpm test:e2e` now runs the real Chromium suite: its
 * per-AC `PASS` closes the gap, while `FAIL` still fails the AC and an `UNVERIFIED`
 * row (no browser on this machine) remains the only acceptable gap.
 *
 * WP-12 T7a reversed WP-10's "no browser" decision: Playwright is a dev-only root
 * dependency now, so `browser-absent` is evaluated against the machine
 * (`scripts/lib/browser-suite.mjs`) instead of being permanently true.
 */
import { browserAvailable, browserUnavailableReason } from './browser-suite.mjs';

/** Isolation attack samples a real browser has to run (AC-002/AC-052). */
export const E2E_BROWSER_ISOLATION_ACS = Object.freeze(['AC-002', 'AC-052']);

/** Viewport/keyboard evidence only a real browser can produce (AC-071/AC-073). */
export const E2E_BROWSER_VIEWPORT_ACS = Object.freeze(['AC-071', 'AC-073']);

/** The Inbox "appear → handled → gone" closure only a real browser can drive (AC-074). */
export const E2E_BROWSER_INBOX_ACS = Object.freeze(['AC-074']);

/** Client-side upload hints only a browser can show (AC-076). */
export const E2E_BROWSER_UPLOAD_ACS = Object.freeze(['AC-076']);

/**
 * The ACs whose browser-side clauses `pnpm test:e2e` executes in Chromium.
 *
 * Since WP-12 T7a these are run by `tests/browser/**` through Playwright whenever the
 * browser is installed; only an environment that genuinely has no browser may report
 * them `UNVERIFIED` (`browser-absent`).
 */
export const E2E_BROWSER_ACS = Object.freeze([
  ...E2E_BROWSER_ISOLATION_ACS,
  ...E2E_BROWSER_VIEWPORT_ACS,
  ...E2E_BROWSER_INBOX_ACS,
  ...E2E_BROWSER_UPLOAD_ACS,
]);

/** The AC `pnpm test:e2e` records as UNVERIFIED because it needs a real model. */
export const E2E_PROVIDER_ACS = Object.freeze(['AC-001']);

/**
 * The AC the operations drill (`scripts/lib/e2e-ops-drill.mjs`) executes with the real
 * `agentdev` CLI on a temporary `AGENTDEV_HOME` (WP-12 G11).
 *
 * AC-064's evidence shape is "真 CLI backup → 损坏 → restore → 比对"; the drill runs the
 * installed binary as a child process, so the evidence is the product path rather than a
 * library call. AC-065 (migration) and AC-094's cross-root clause stay at the library
 * layer by the hardening plan §3.1 (destructive storage injection / unimplemented
 * identity migration) — they are deliberately *not* listed here and must not be registered
 * as `recorded-gap`, which would downgrade an otherwise passing AC.
 */
export const E2E_OPS_ACS = Object.freeze(['AC-064']);

/** The ACs each `pnpm test:live` drill closes when the real Provider answers. */
export const LIVE_DRILL_ACS = Object.freeze({
  html: ['AC-001'],
  l1: ['AC-007'],
  l2: ['AC-010', 'AC-037', 'AC-041'],
  // The no-seed message→Chief→dispatch→stage chain (WP-12 T2.7 / R3-2b).
  messageToStage: ['AC-003', 'AC-005', 'AC-069'],
  // Real Pi session streaming + stored-session recovery (AC-066).
  session: ['AC-066'],
});

/** The AC a distinct Review/Test model would close. */
export const INDEPENDENT_MODEL_AC = 'AC-043';

/** Every AC the live drill can report on (used by the acceptance summary). */
export const LIVE_REPORTED_ACS = Object.freeze([
  ...new Set([...Object.values(LIVE_DRILL_ACS).flat(), INDEPENDENT_MODEL_AC]),
]);

/**
 * Accepted gaps, keyed by AC.
 *
 * `condition` is what makes the gap tolerable; the aggregator re-checks it every run,
 * so an accepted gap can never hide a drill that should have run and did not:
 *
 * - `provider-absent`      — only valid while `AGENTDEV_PROVIDER_*` is incomplete.
 * - `review-model-absent`  — only valid while `AGENTDEV_PROVIDER_REVIEW_MODEL` is unset.
 * - `browser-absent`       — only valid while Playwright/Chromium is not runnable here
 *                            (WP-12 T7a reversed WP-10's "no browser" decision).
 * - `recorded-gap`         — a product/environment shortfall recorded with a residual id
 *                            and accepted by a user decision; permanent until the
 *                            residual is implemented.
 *
 * `decision` names the record that authorises the acceptance, so a gap is never
 * silently invented by the tooling.
 */
export const RESIDUAL_GAPS = Object.freeze({
  'AC-001': {
    condition: 'provider-absent',
    closedBy: 'pnpm test:live',
    decision: 'WP-10 plan.md §2 D2（真实 Provider 由用户提供；未提供时 AC-001 保持 UNVERIFIED）',
    gap: '真实 Provider 的“区分事实/未知”答复未执行：离线只证明只读路由（不建 Requirement、不授权、Work 保持 level none），模型层断言需要 `pnpm test:live`。',
  },
  'AC-007': {
    condition: 'provider-absent',
    closedBy: 'pnpm test:live',
    decision: 'WP-10 plan.md §2 D2',
    gap: 'L1 全链（一句话 Plan → 独立执行/Review/Settlement → CAS/CompletionManifest）的真实模型执行由 `pnpm test:live` 的 L1 演练覆盖；未配置 Provider 时该演练 UNVERIFIED，提交用例只证明领域规则与 Gate 顺序。',
  },
  'AC-010': {
    condition: 'provider-absent',
    closedBy: 'pnpm test:live',
    decision: 'WP-10 plan.md §2 D2',
    gap: 'L2 交付链的真实模型纵向执行由 `pnpm test:live` 的 L2 演练覆盖；未配置 Provider 时该演练 UNVERIFIED，提交用例与 e2e 演练只证明真实 Gate/阶段顺序与交付物（输入由演练构造）。',
  },
  'AC-037': {
    condition: 'provider-absent',
    closedBy: 'pnpm test:live',
    decision: 'WP-10 plan.md §2 D2',
    gap: '真实模型产出的知识补丁纵向执行由 `pnpm test:live` 的 L2 演练覆盖；未配置 Provider 时为 UNVERIFIED，提交测试只证明补丁/投影规则本身。',
  },
  'AC-041': {
    condition: 'provider-absent',
    closedBy: 'pnpm test:live',
    decision: 'WP-10 plan.md §2 D2',
    gap: '真实模型结算后的知识更新与冷启动由 `pnpm test:live` 的 L2 演练覆盖；未配置 Provider 时为 UNVERIFIED，提交测试只证明投影与冷启动规则。',
  },
  // WP-12 G4 (`chief.message-to-stage`): the no-seed message→Chief→dispatch→stage chain is
  // executed offline by `pnpm test:e2e` (application layer, loopback model) *and* by
  // `pnpm test:live` with the real model. Without a configured Provider the live half is
  // UNVERIFIED, so these ACs carry the same accepted gap shape as AC-001/007/010/037/041;
  // the offline drill is already a per-AC PASS row and is named here so the gap cannot hide
  // a drill that failed.
  'AC-003': {
    condition: 'provider-absent',
    closedBy: 'pnpm test:live',
    decision:
      'WP-10 plan.md §2 D2（真实 Provider 由用户提供；未提供时该 AC 的真实模型那一半保持 UNVERIFIED）；离线产品路径由 pnpm test:e2e 的 chief.message-to-stage（真 daemon + 真 Runner 子进程 + 回环桩）与 apps/daemon/test/assessment-dispatch.integration.test.ts 覆盖',
    gap: '真实模型下的“一句话 → Chief 评估 → 派发”未执行；离线演练与提交用例只证明真实协议/控制端点/监督器链与派生授权。',
  },
  'AC-005': {
    condition: 'provider-absent',
    closedBy: 'pnpm test:live',
    decision:
      'WP-10 plan.md §2 D2；离线产品路径由 pnpm test:e2e 的 chief.message-to-stage（真实 message→Work→授权→Requirement）覆盖',
    gap: '真实模型下“用户明确指令才派生授权”的判断未执行；离线演练证明授权确实来自消息且未授权不建交付。',
  },
  'AC-069': {
    condition: 'provider-absent',
    closedBy: 'pnpm test:live',
    decision:
      'WP-10 plan.md §2 D2；离线产品路径由 pnpm test:e2e 的 chief.message-to-stage 与 chief.routes-message 覆盖',
    gap: '真实模型下的消息路由（只读询问 vs 交付）未执行；离线演练与提交用例证明路由规则与真实协议行。',
  },
  'AC-043': {
    condition: 'review-model-absent',
    closedBy: 'pnpm test:live',
    decision: 'WP-10 plan.md §2 D2（`AGENTDEV_PROVIDER_REVIEW_MODEL` 未提供）',
    gap: '“角色配置不同 Provider/模型”需要为 Review/Test 指定独立模型（`AGENTDEV_PROVIDER_REVIEW_MODEL`）；未指定时全部角色共用一个已配置模型，只证明专业 Run 独立且各自冻结快照。',
  },
  'AC-002': {
    condition: 'browser-absent',
    closedBy: 'pnpm test:e2e',
    decision:
      'WP-10 plan.md §2 D1 已被 WP-12 T7a 撤销：Playwright 与 Chromium 安装后该豁免条件不再成立，浏览器证据必须真实执行；仅当本环境确实没有浏览器时，本登记项才继续有效',
    gap: '真实浏览器中的隔离预览与脚本隔离未执行；提交用例与演练只证明 CSP/sandbox/credentials 预览头、一次性下载 token 与截断。',
  },
  'AC-052': {
    condition: 'browser-absent',
    closedBy: 'pnpm test:e2e',
    decision: 'WP-10 plan.md §2 D1 已被 WP-12 T7a 撤销（同上）',
    gap: '真实浏览器中的攻击样例（读 cookie/网络/父页）未执行；提交用例只证明预览隔离策略与无 cookie。',
  },
  'AC-071': {
    condition: 'browser-absent',
    closedBy: 'pnpm test:e2e',
    decision: 'WP-10 plan.md §2 D1 已被 WP-12 T7a 撤销（同上）',
    gap: '真实 viewport 截图与焦点切换未执行；演练与提交用例只证明面板三态、共享宽度标记与不干扰 Run。',
  },
  'AC-073': {
    condition: 'browser-absent',
    closedBy: 'pnpm test:e2e',
    decision: 'WP-10 plan.md §2 D1 已被 WP-12 T7a 撤销（同上）',
    gap: '真实浏览器键盘遍历与 ARIA 朗读未执行；提交用例只证明字典级语言切换与项目内容不被翻译。',
  },
  'AC-066': {
    // Closed by the real-Provider drill `drill.session-streaming` (WP-12 R3-3): a real Pi
    // session over the Core gateway produced a streamed `text_delta`, and a **new** factory
    // resumed the stored session file with the same session id and continued appending.
    // The gap is therefore only "no Provider configured here" — no longer a recorded gap.
    condition: 'provider-absent',
    closedBy: 'pnpm test:live',
    decision:
      'WP-12 R3-3：`drill.session-streaming` 用真实 Provider 关闭该缺口（真实 Pi 会话经 Core gateway 产出流式 text_delta；新 factory 复用同一 session 文件与会话 id 并继续追加记录）。仅在未配置 AGENTDEV_PROVIDER_* 时保持 UNVERIFIED。',
    gap: '真实 Provider 下的一轮 Pi SDK 会话（流式增量与会话历史恢复）尚未执行；配置 AGENTDEV_PROVIDER_* 后由 `pnpm test:live` 的 `drill.session-streaming` 关闭。',
  },
  'AC-076': {
    condition: 'browser-absent',
    closedBy: 'pnpm test:e2e',
    decision: 'WP-10 plan.md §2 D1 已被 WP-12 T7a 撤销（同上）',
    gap: '客户端的超数量/大小/类型提示需要浏览器执行；服务端拒绝（无残留引用）已由提交用例与 e2e 演练执行。',
  },
});

/** True when the three Provider variables are all non-empty. */
export function providerConfigured(env = process.env) {
  return [
    'AGENTDEV_PROVIDER_BASE_URL',
    'AGENTDEV_PROVIDER_MODEL',
    'AGENTDEV_PROVIDER_SECRET',
  ].every((name) => typeof env[name] === 'string' && env[name].length > 0);
}

/** True when a distinct Review/Test model is configured. */
export function reviewModelConfigured(env = process.env) {
  return (
    typeof env.AGENTDEV_PROVIDER_REVIEW_MODEL === 'string' &&
    env.AGENTDEV_PROVIDER_REVIEW_MODEL.length > 0
  );
}

/**
 * Evaluates the condition behind one accepted gap.
 *
 * @param {'provider-absent'|'review-model-absent'|'browser-absent'} condition
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ holds: boolean, why: string }}
 */
export function conditionHolds(condition, env = process.env) {
  if (condition === 'recorded-gap') {
    return {
      holds: true,
      why: '该缺口由决定记录授权的常驻残余（实现该残余前一直成立）；验收报告逐条列出缺口与决定',
    };
  }
  if (condition === 'browser-absent') {
    // WP-12 T7a: the gap is only tolerable while the environment genuinely has no
    // browser. Once Playwright and its Chromium binary are installed, an unexecuted
    // browser AC is a FAIL, not an accepted gap.
    const holds = !browserAvailable();
    return {
      holds,
      why: holds
        ? `本环境确实没有可运行的浏览器：${browserUnavailableReason()}`
        : `Playwright 与 Chromium 已安装（${browserUnavailableReason()}），因此“没有浏览器”不再是有效理由：pnpm test:e2e 必须真实执行并报告这些 AC`,
    };
  }
  if (condition === 'provider-absent') {
    const holds = !providerConfigured(env);
    return {
      holds,
      why: holds
        ? 'AGENTDEV_PROVIDER_BASE_URL/MODEL/SECRET 未配置，真实 Provider 演练无法执行'
        : 'AGENTDEV_PROVIDER_* 已配置，因此“未配置 Provider”不再是有效理由：真实演练必须执行并通过',
    };
  }
  if (condition === 'review-model-absent') {
    const holds = !reviewModelConfigured(env);
    return {
      holds,
      why: holds
        ? 'AGENTDEV_PROVIDER_REVIEW_MODEL 未配置，Review/Test 无法使用独立模型'
        : 'AGENTDEV_PROVIDER_REVIEW_MODEL 已配置，因此“无独立模型”不再是有效理由：演练必须按 PASS 记录该 AC',
    };
  }
  return { holds: false, why: `未知的豁免条件 ${String(condition)}` };
}

/*
 * AC-046 / AC-047 are proven at the **integration layer** by committed Vitest cases, not
 * by a release drill in `scripts/e2e.mjs`:
 *
 * - AC-046 `packages/core/test/join.integration.test.ts` — one real Chief dispatch creates
 *   two parallel child Runs; the required child fails through the real two-strike StageGate,
 *   the sibling's `stage_result` survives, the parent stays `waiting_children`, the join
 *   files exactly one `chief_action_required` carrying every child, and a new Chief
 *   instruction is still processed.
 * - AC-047 `apps/daemon/test/stage-contract-runner.integration.test.ts` — a real message →
 *   real Chief child → real `agent.dispatch` → a real `apps/runner` child whose model only
 *   *says* it finished: the first spoken end receives the corrective prompt, the second is
 *   recorded as `contract_violation` with no stage result.
 *
 * `scripts/acceptance.mjs` adopts both **by test name** (each executed case's name carries
 * its AC id; verified as `mapping: 'test-name'`), so they must NOT be added to
 * `RESIDUAL_GAPS`: a `recorded-gap` entry would downgrade an already passing,
 * application-layer AC to UNVERIFIED.
 */
