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
 * `PASS`); a gap without `closedBy` is a product/browser shortfall no drill can close.
 * The aggregator downgrades a registered AC to UNVERIFIED until its gap is closed, and
 * only accepts that UNVERIFIED while the named condition still holds — see
 * `scripts/acceptance.mjs`.
 */

/** Isolation attack samples a real browser would have to run (AC-002/AC-052). */
export const E2E_BROWSER_ISOLATION_ACS = Object.freeze(['AC-002', 'AC-052']);

/** Viewport/keyboard evidence only a real browser can produce (AC-071/AC-073). */
export const E2E_BROWSER_VIEWPORT_ACS = Object.freeze(['AC-071', 'AC-073']);

/** Client-side upload hints only a browser can show (AC-076). */
export const E2E_BROWSER_UPLOAD_ACS = Object.freeze(['AC-076']);

/** The ACs `pnpm test:e2e` can never close because it ships no browser. */
export const E2E_BROWSER_ACS = Object.freeze([
  ...E2E_BROWSER_ISOLATION_ACS,
  ...E2E_BROWSER_VIEWPORT_ACS,
  ...E2E_BROWSER_UPLOAD_ACS,
]);

/** The AC `pnpm test:e2e` records as UNVERIFIED because it needs a real model. */
export const E2E_PROVIDER_ACS = Object.freeze(['AC-001']);

/** The ACs each `pnpm test:live` drill closes when the real Provider answers. */
export const LIVE_DRILL_ACS = Object.freeze({
  html: ['AC-001'],
  l1: ['AC-007'],
  l2: ['AC-010', 'AC-037', 'AC-041'],
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
 * - `browser-absent`       — permanent: product decision D1 (WP-10) ships no browser.
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
  'AC-043': {
    condition: 'review-model-absent',
    closedBy: 'pnpm test:live',
    decision: 'WP-10 plan.md §2 D2（`AGENTDEV_PROVIDER_REVIEW_MODEL` 未提供）',
    gap: '“角色配置不同 Provider/模型”需要为 Review/Test 指定独立模型（`AGENTDEV_PROVIDER_REVIEW_MODEL`）；未指定时全部角色共用一个已配置模型，只证明专业 Run 独立且各自冻结快照。',
  },
  'AC-002': {
    condition: 'browser-absent',
    decision: 'WP-10 plan.md §2 D1（用户确认不引入 Playwright / 浏览器下载）',
    gap: '真实浏览器中的隔离预览与脚本隔离未执行；提交用例与演练只证明 CSP/sandbox/credentials 预览头、一次性下载 token 与截断。',
  },
  'AC-052': {
    condition: 'browser-absent',
    decision: 'WP-10 plan.md §2 D1',
    gap: '真实浏览器中的攻击样例（读 cookie/网络/父页）未执行；提交用例只证明预览隔离策略与无 cookie。',
  },
  'AC-071': {
    condition: 'browser-absent',
    decision: 'WP-10 plan.md §2 D1',
    gap: '真实 viewport 截图与焦点切换未执行；演练与提交用例只证明面板三态、共享宽度标记与不干扰 Run。',
  },
  'AC-073': {
    condition: 'browser-absent',
    decision: 'WP-10 plan.md §2 D1',
    gap: '真实浏览器键盘遍历与 ARIA 朗读未执行；提交用例只证明字典级语言切换与项目内容不被翻译。',
  },
  'AC-066': {
    condition: 'recorded-gap',
    residual: 'WP-10-D4/AC-066',
    decision:
      'WP-10 plan.md §2 D4（用户确认）：接受为已登记缺口，真实模型的一轮 Pi SDK 会话（流式增量与会话历史恢复）未在发布验收中执行',
    gap: 'AC-066 的 SDK 契约由锁定版本 0.85.1 的真实适配测试逐用例证明（事件映射含 assistant 文本/thinking 增量、工具边界、压缩、订阅、abort、资源释放、resume 路径接线）；但“真实模型经 Pi SDK 产生流式增量并从存储会话恢复历史”需要 Runner 侧真实驱动 Pi SDK 的生产级 models.json 与凭证注入，本包未执行，登记为已登记缺口。',
  },
  'AC-090': {
    condition: 'recorded-gap',
    residual: 'WP-10-D4/AC-090',
    decision:
      'WP-10 plan.md §2 D4（用户确认）：接受为已登记缺口，界面侧的“分支/提交/未推送状态”展示未实现',
    gap: 'AC-090 的 Git 侧与投影侧已由真实临时仓库、真实 SQLite 与 e2e 演练证明（原子提交两文件、recordVersion/recordHash、saveState 仅在与投影一致后为 saved、retry 恢复原操作、e2e 断言 git.unpushed=true）；但 Web 界面尚未渲染“分支、提交与未推送状态”（`apps/web/src` 无对应视图字段），该 Then 子句未实现，登记为已登记缺口。',
  },
  'AC-076': {
    condition: 'browser-absent',
    decision: 'WP-10 plan.md §2 D1',
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
    return {
      holds: true,
      why: '本发布不提供浏览器运行时（产品决定 D1），该缺口在本次发布内不可关闭',
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
