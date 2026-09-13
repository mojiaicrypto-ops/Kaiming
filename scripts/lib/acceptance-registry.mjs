/**
 * Release acceptance registry.
 *
 * `docs/delivery/acceptance.md` is the single catalog of release contracts: every
 * `AC-NNN` case carries a Given/When/Then sentence and an evidence hint. This module
 * turns that document into a machine-checked registry and holds the two mapping aids
 * the aggregator needs when the committed suites do not spell an AC id in a test name:
 *
 * 1. `SUPPLEMENTAL_EVIDENCE` — committed test cases that prove a specific AC without
 *    naming it, cross-checked against the owning work package records. Every entry is
 *    resolved against the executed Vitest report; an unresolved entry fails closed.
 * 2. `DRILL_DEPENDENCIES` / `KNOWN_RESIDUALS` — the parts of an AC that only a release
 *    drill (real browser, real Provider, Docker) can execute, so the report can state
 *    precisely what remains UNVERIFIED instead of over-claiming.
 *
 * Nothing here decides PASS: it only describes how evidence is found. The executed
 * test result is always the authority.
 */

/** Path of the canonical acceptance catalog, relative to the repository root. */
export const ACCEPTANCE_DOC = 'docs/delivery/acceptance.md';

/** The registry must cover exactly AC-001 … AC-094. */
export const EXPECTED_AC_IDS = Object.freeze(
  Array.from({ length: 94 }, (_, index) => `AC-${String(index + 1).padStart(3, '0')}`),
);

const VALID_AC = new Set(EXPECTED_AC_IDS);

/** Every AC id the release catalog defines. @param {string} id */
export function isValidAcId(id) {
  return VALID_AC.has(id);
}

/**
 * Extracts acceptance ids from arbitrary text, expanding the shorthand the repository
 * uses (`AC-026/027/042`, `AC-007…AC-021`). Only registered ids are returned, so
 * deliberate negative fixtures such as `AC-999` never enter the aggregate.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
export function extractAcIds(text) {
  const found = new Set();
  if (typeof text !== 'string' || text.length === 0) return found;
  const pattern = /AC-(\d{3})((?:\/\d{3})*)/g;
  let match = pattern.exec(text);
  while (match !== null) {
    const head = `AC-${match[1]}`;
    if (VALID_AC.has(head)) found.add(head);
    for (const tail of match[2].split('/')) {
      if (tail.length === 0) continue;
      const id = `AC-${tail}`;
      if (VALID_AC.has(id)) found.add(id);
    }
    match = pattern.exec(text);
  }
  return found;
}

/** Strips the connectors used between Given/When/Then clauses. @param {string} value */
function trimClause(value) {
  return value
    .replace(/^[\s；;。，,]+/, '')
    .replace(/[\s；;。，,]+$/, '')
    .trim();
}

/** Splits the `关联：REQ-X。Given …；When …；Then …。` sentence into its clauses. */
function splitGivenWhenThen(sentence) {
  const given = sentence.indexOf('Given');
  const when = sentence.indexOf('When');
  const then = sentence.indexOf('Then');
  const end = sentence.length;
  const slice = (start, stop) => (start < 0 ? '' : trimClause(sentence.slice(start, stop)));
  return {
    given: slice(given < 0 ? -1 : given + 'Given'.length, when > given ? when : end),
    when: slice(when < 0 ? -1 : when + 'When'.length, then > when ? then : end),
    then: slice(then < 0 ? -1 : then + 'Then'.length, end),
  };
}

/**
 * Parses `docs/delivery/acceptance.md` into the AC registry.
 *
 * The catalog uses one `### AC-NNN Title` section per case; the `关联：` line carries
 * the requirement id and the Given/When/Then sentence, and the `证据：` line carries
 * the evidence hint. Collection stops at the next `## ` section so the appendices
 * (test layers, fixtures) can never leak into the last case.
 *
 * @param {string} markdown
 * @returns {{ cases: Array<object>, problems: string[] }}
 */
export function parseAcceptanceDoc(markdown) {
  const cases = [];
  const problems = [];
  let current = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^###\s+(AC-\d{3})\s+(.+?)\s*$/.exec(line);
    if (heading !== null) {
      current = {
        id: heading[1],
        title: heading[2],
        requirement: '',
        given: '',
        when: '',
        then: '',
        evidence: '',
        extras: [],
      };
      cases.push(current);
      continue;
    }
    if (/^#{1,2}\s/.test(line)) {
      current = null;
      continue;
    }
    if (current === null) continue;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('关联：')) {
      const relation = /^关联：\s*(REQ-[A-Z]+-\d+)?[。.]?\s*([\s\S]*)$/.exec(trimmed);
      current.requirement = relation?.[1] ?? '';
      const clauses = splitGivenWhenThen(relation?.[2] ?? '');
      current.given = clauses.given;
      current.when = clauses.when;
      current.then = clauses.then;
      continue;
    }
    if (trimmed.startsWith('证据：')) {
      current.evidence = trimmed.slice('证据：'.length).trim();
      continue;
    }
    current.extras.push(trimmed);
  }

  const seen = new Set();
  for (const entry of cases) {
    if (seen.has(entry.id)) problems.push(`duplicate acceptance case ${entry.id}`);
    seen.add(entry.id);
    if (!VALID_AC.has(entry.id))
      problems.push(`acceptance case outside AC-001..AC-094: ${entry.id}`);
    if (!entry.requirement.startsWith('REQ-')) {
      problems.push(`${entry.id} is missing its REQ-* relation`);
    }
    for (const clause of ['given', 'when', 'then']) {
      if (entry[clause].length === 0) problems.push(`${entry.id} is missing its ${clause} clause`);
    }
    if (entry.evidence.length === 0) problems.push(`${entry.id} is missing its evidence hint`);
  }
  for (const expected of EXPECTED_AC_IDS) {
    if (!seen.has(expected)) problems.push(`acceptance case ${expected} is not defined`);
  }
  const ordered = cases
    .slice()
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return { cases: ordered, problems };
}

/**
 * Committed test cases that prove an AC without carrying its id in the test name or
 * a file-level AC comment. Each entry names the work package that owns the claim so a
 * reviewer can audit why the mapping is legitimate. The aggregator requires every
 * entry to resolve to an executed Vitest case; an unresolved entry is a hard failure.
 */
export const SUPPLEMENTAL_EVIDENCE = Object.freeze({
  'AC-004': [
    {
      file: 'packages/domain/test/domain.test.ts',
      title: 'routes assist and artifact to none',
      rationale:
        'assist keeps level "none", so a question never enters a delivery route or Plan gate',
      wpRecord: '.agentdev/work/WP-03/test.md',
    },
    {
      file: 'apps/daemon/test/server.test.ts',
      title: 'keeps questions, advice and statements read-only end to end',
      rationale:
        'questions/advice/statements create no authorizations and leave every Work at level none',
      wpRecord: '.agentdev/work/WP-03/test.md',
    },
  ],
  'AC-067': [
    {
      file: 'packages/pi-runtime/test/extensions.test.ts',
      title: 'rejects an id the release does not ship',
      rationale: 'unknown extension id is refused',
      wpRecord: '.agentdev/work/WP-00/test-report.md',
    },
    {
      file: 'packages/pi-runtime/test/extensions.test.ts',
      title: 'blocks startup when a critical capability fails',
      rationale: 'a failed Critical capability blocks startup',
      wpRecord: '.agentdev/work/WP-00/test-report.md',
    },
    {
      file: 'packages/pi-runtime/test/extensions.test.ts',
      title: 'disables only the failing optional extension',
      rationale: 'an optional extension failure disables only itself',
      wpRecord: '.agentdev/work/WP-00/test-report.md',
    },
    {
      file: 'apps/runner/test/attempt.integration.test.ts',
      title: 'blocks the attempt when a critical extension fails, before any session exists',
      rationale: 'the Runner-level Critical gate stops before a session is created',
      wpRecord: '.agentdev/work/WP-00/implementation.md',
    },
    {
      file: 'apps/runner/test/attempt.integration.test.ts',
      title: 'rejects an extension id the release does not ship',
      rationale: 'the Runner rejects an unknown extension id',
      wpRecord: '.agentdev/work/WP-00/implementation.md',
    },
  ],
  'AC-086': [
    {
      file: 'packages/knowledge/test/feature-format.test.ts',
      title: 'parses a complete document with real-valued fields',
      rationale: 'the complete evidence sample publishes',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
    {
      file: 'packages/knowledge/test/feature-format.test.ts',
      title: 'rejects design=confirmed without one resolvable decision reference',
      rationale: 'a claimed confirmation without its source is refused',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
    {
      file: 'packages/knowledge/test/feature-format.test.ts',
      title: 'rejects verification=passed without evidence references',
      rationale: 'a passed claim without evidence is refused',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
    {
      file: 'packages/knowledge/test/feature-format.test.ts',
      title: 'rejects verification=passed without coverage',
      rationale: 'a passed claim without coverage is refused',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
    {
      file: 'packages/knowledge/test/feature-format.test.ts',
      title: 'rejects verification=passed recorded against another code tree',
      rationale: 'a passed claim bound to the wrong revision is refused',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
    {
      file: 'packages/knowledge/test/feature-format.test.ts',
      title: 'rejects investigation=investigated without a scope',
      rationale: 'an investigated claim without scope is refused',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
    {
      file: 'packages/knowledge/test/feature-format.test.ts',
      title: 'rejects investigation=investigated without sources',
      rationale: 'an investigated claim without sources is refused',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
  ],
});

/** Reason prefixes used when an AC cannot be executed in this environment. */
export const ENVIRONMENT_REASONS = Object.freeze({
  browser:
    '需要真实浏览器/无头浏览器演练（pnpm test:e2e）。本仓库按产品决定不引入 Playwright 或浏览器下载，因此浏览器级检查未执行',
  provider:
    '需要真实 Provider 纵向演练（pnpm test:live 及 AGENTDEV_PROVIDER_BASE_URL/MODEL/SECRET）。本环境未配置 Provider，演练未执行',
  generic: '没有任何已提交测试或已运行演练覆盖该 AC；需要相应发布演练或人工环境',
});

/**
 * ACs whose full Given/When/Then needs an environment this command cannot supply.
 * The aggregator uses the reason only when no executed evidence exists; a drill report
 * (`--drill-report`) overrides it.
 */
export const DRILL_DEPENDENCIES = Object.freeze({
  'AC-001': {
    drill: 'live',
    reason:
      'AC-001 的 Then 要求 Chief 区分事实/未知，只能由真实 Provider 的问答演练（pnpm test:live）执行；仓库内没有提交测试覆盖该模型输出，本环境也未配置 AGENTDEV_PROVIDER_*',
  },
  'AC-011': {
    drill: 'live',
    reason: 'AC-011 的真实数据迁移与回退执行需要发布环境演练；仓库测试只覆盖 L3 结构化证据链',
  },
  'AC-043': {
    drill: 'live',
    reason: 'AC-043 的真实多 Provider 分派需要 pnpm test:live 与 AGENTDEV_PROVIDER_*',
  },
  'AC-066': {
    drill: 'live',
    reason: 'AC-066 的真实模型流式事件与会话历史恢复需要 pnpm test:live 与 AGENTDEV_PROVIDER_*',
  },
});

/** Parts of an AC that stay unexecuted even when its committed tests pass. */
export const KNOWN_RESIDUALS = Object.freeze({
  'AC-001':
    '离线部分由已提交的只读路由用例覆盖（不建 Requirement、不授权、Work 保持 level none）；模型层“区分事实/未知”未执行',
  'AC-002':
    '真实浏览器渲染与隔离未执行；已提交用例覆盖 CSP/sandbox 预览头、一次性下载 token 与截断',
  'AC-011': '真实迁移/回退输出未执行；已提交用例覆盖 L3 授权、回退与逐项审核的结构化证据',
  'AC-043': '真实多 Provider 连通未执行；已提交用例覆盖冻结角色配置与模型网关（Provider 桩）',
  'AC-052': '真实浏览器攻击样例未执行；已提交用例覆盖预览的 CSP/sandbox 隔离策略与无 cookie',
  'AC-054': '真实无头浏览器断开/重连未执行；已提交用例覆盖 WS 水位续订与后台 Work 继续运行',
  'AC-066': '真实模型流式增量与会话历史恢复未执行；已提交用例覆盖创建/订阅/abort/压缩/资源契约',
  'AC-071': '真实 viewport 截图与焦点切换未执行；已提交用例覆盖面板三态恢复与 tab 顺序',
  'AC-073': '真实浏览器键盘遍历/ARIA 未执行；已提交用例覆盖字典级语言切换与项目内容不翻译',
});

/** Normalizes a drill status string. Returns null when it is not recognized. */
function normalizeDrillStatus(value) {
  const status = String(value ?? '')
    .trim()
    .toUpperCase();
  if (['PASS', 'PASSED', 'OK', 'SUCCESS'].includes(status)) return 'PASS';
  if (['FAIL', 'FAILED', 'ERROR'].includes(status)) return 'FAIL';
  if (['UNVERIFIED', 'SKIP', 'SKIPPED', 'NOT_RUN', 'PENDING'].includes(status)) return 'UNVERIFIED';
  return null;
}

/**
 * Parses a drill report into `Map<ac, {status, evidence}>`.
 *
 * Accepted shapes (produced by the e2e/live drills):
 *   { "results": [ { "ac": "AC-002", "status": "PASS", "evidence": "..." } ] }
 *   { "AC-002": { "status": "PASS", "evidence": "..." } }
 *   { "AC-002": "PASS" }
 *
 * Unknown statuses, unknown AC ids and malformed rows are reported as problems instead
 * of being silently dropped, so a broken drill report cannot fake success.
 *
 * @param {unknown} payload
 * @param {string} sourceFile
 * @returns {{ results: Map<string, object>, problems: string[] }}
 */
export function parseDrillReport(payload, sourceFile) {
  const results = new Map();
  const problems = [];
  const push = (rawId, rawStatus, evidence) => {
    const id = String(rawId ?? '')
      .trim()
      .toUpperCase();
    if (!VALID_AC.has(id)) {
      problems.push(`${sourceFile}: ignoring unregistered acceptance id "${rawId}"`);
      return;
    }
    const status = normalizeDrillStatus(rawStatus);
    if (status === null) {
      problems.push(`${sourceFile}: unknown drill status "${rawStatus}" for ${id}`);
      return;
    }
    results.set(id, {
      status,
      evidence:
        typeof evidence === 'string' && evidence.length > 0 ? evidence : '(no evidence text)',
      sourceFile,
    });
  };

  if (payload === null || typeof payload !== 'object') {
    problems.push(`${sourceFile}: drill report is not a JSON object`);
    return { results, problems };
  }
  if (Array.isArray(payload.results)) {
    for (const row of payload.results) {
      if (row === null || typeof row !== 'object') {
        problems.push(`${sourceFile}: ignoring a non-object drill row`);
        continue;
      }
      const record = /** @type {Record<string, unknown>} */ (row);
      push(
        record.ac ?? record.acceptanceId ?? record.id,
        record.status,
        record.evidence ?? record.detail,
      );
    }
    return { results, problems };
  }
  for (const [key, value] of Object.entries(payload)) {
    if (value !== null && typeof value === 'object') {
      const record = /** @type {Record<string, unknown>} */ (value);
      push(key, record.status, record.evidence ?? record.detail);
    } else {
      push(key, value, undefined);
    }
  }
  return { results, problems };
}

/**
 * Reason shown when an AC has no executed evidence at all. Prefers the drill
 * dependency note, then the evidence hint's own environment keyword.
 *
 * @param {string} ac
 * @param {{ evidence?: string }} acceptanceCase
 */
export function missingEnvironmentReason(ac, acceptanceCase) {
  const dependency = DRILL_DEPENDENCIES[ac];
  if (dependency !== undefined) return dependency.reason;
  const hint = acceptanceCase?.evidence ?? '';
  if (/浏览器|截图|viewport|a11y/i.test(hint)) return ENVIRONMENT_REASONS.browser;
  if (/Provider|真实模型/.test(hint)) return ENVIRONMENT_REASONS.provider;
  return ENVIRONMENT_REASONS.generic;
}
