/**
 * Release acceptance registry.
 *
 * `docs/delivery/acceptance.md` is the single catalog of release contracts: every
 * `AC-NNN` case carries a Given/When/Then sentence and an evidence hint. This module
 * turns that document into a machine-checked registry and holds the two mapping aids
 * the aggregator needs when the committed suites do not spell an AC id in a test name:
 *
 * 1. `CURATED_EVIDENCE` — committed test cases that prove a specific AC without
 *    naming it, cross-checked against the owning work package records. Every entry is
 *    resolved against the executed Vitest report; an unresolved entry fails closed.
 *    There is deliberately **no** file-level mapping any more: WP-10 review round 1
 *    (W10R1-04) showed that mapping every executed case of a file to one AC let an
 *    unrelated case in the same file stand in for a deleted key case.
 * 2. `RESIDUAL_GAPS` (`./drill-acs.mjs`) — the accepted gaps: the parts of an AC that
 *    only a release drill (real browser, real Provider, distinct Review/Test model) can
 *    execute, with the condition that makes the gap tolerable and the decision record
 *    that authorises it.
 *
 * Nothing here decides PASS: it only describes how evidence is found. The executed
 * test result is always the authority.
 */

import { RESIDUAL_GAPS } from './drill-acs.mjs';

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
 * Committed test cases that prove an AC without carrying its id in the test name.
 *
 * Each entry names the work package that owns the claim so a reviewer can audit why the
 * mapping is legitimate. The aggregator requires **every** entry to resolve to an
 * executed Vitest case, and a mapped AC is only `PASS` when all of its entries did.
 */
export const CURATED_EVIDENCE = Object.freeze({
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
  'AC-011': [
    {
      file: 'packages/core/test/delivery.integration.test.ts',
      title:
        'requires explicit authorization, rollback, per-item audit and a recovery drill before an L3 migration is implemented (AC-011)',
      rationale:
        'the L3 gate refuses the implementation until authorization, rollback plan, per-item audit and recovery evidence exist',
      wpRecord: '.agentdev/work/WP-06/test.md',
    },
    {
      file: 'packages/storage/test/migrations.integration.test.ts',
      title: 'migrations rolls a failed migration back and reports its version',
      rationale:
        'a real failed migration is rolled back inside its transaction and its version reported',
      wpRecord: '.agentdev/work/WP-01/test.md',
    },
    {
      file: 'packages/core/test/backup.integration.test.ts',
      title:
        'Backup, restore and relocate (AC-064) restores a backup into a new directory with consistent hashes, knowledge and evidence',
      rationale:
        'the real recovery drill restores a backup with consistent hashes, knowledge and evidence',
      wpRecord: '.agentdev/work/WP-08/test.md',
    },
  ],
  'AC-026': [
    {
      file: 'packages/workspace/test/scan.test.ts',
      title:
        'scanProject budgets stops at 40 body files and reports a partial map with explicit unknowns',
      rationale:
        'the bounded investigation stops at the documented budget and names what it did not read',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
    {
      file: 'packages/workspace/test/scan.test.ts',
      title: 'scanProject budgets stops before exceeding 512 KiB of body content',
      rationale: 'the body budget is a real bound, not a promise',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
    {
      file: 'packages/workspace/test/scan.test.ts',
      title:
        'scanProject exclusions does not follow symlinks and reports escapes and broken links as unknowns',
      rationale: 'source/unknown separation: an unreadable path becomes an explicit unknown',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
    {
      file: 'packages/workspace/test/scan.test.ts',
      title:
        'candidate knowledge generates observed candidate features and documents without touching a delivery ref',
      rationale:
        'initialization produces candidate knowledge and never moves code or a delivery ref',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
    {
      file: 'packages/workspace/test/scan.test.ts',
      title:
        'candidate knowledge records git-unavailable as an unknown instead of claiming a revision',
      rationale: 'the source revision is reported as unknown rather than invented',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
    {
      file: 'packages/workspace/test/scan.test.ts',
      title: 'file fixtures stay untouched by scanning does not create files while scanning',
      rationale: 'the investigation does not move or create project files',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
  ],
  'AC-027': [
    {
      file: 'packages/workspace/test/initialize.test.ts',
      title: 'no-Git directory returns Blocked with the Git-initialization authorization request',
      rationale:
        'a formal write in a directory without Git is blocked behind an explicit Git-initialization authorization',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
    {
      file: 'packages/workspace/test/initialize.test.ts',
      title:
        'dirty workspace blocks delivery start with a hash report while read-only investigation still works',
      rationale: 'the read-only question lane still completes while the write lane is blocked',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
  ],
  'AC-028': [
    {
      file: 'packages/workspace/test/initialize.test.ts',
      title:
        'dirty workspace blocks delivery start with a hash report while read-only investigation still works',
      rationale:
        'uncommitted user files are preserved and reported as a hash, delivery start is blocked until explicit handling',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
  ],
  'AC-065': [
    {
      file: 'packages/storage/test/migrations.integration.test.ts',
      title: 'migrations backs up before pending work and writes a usable copy',
      rationale: 'a real backup is written before pending migration work',
      wpRecord: '.agentdev/work/WP-01/test.md',
    },
    {
      file: 'packages/storage/test/migrations.integration.test.ts',
      title: 'migrations rolls a failed migration back and reports its version',
      rationale: 'the migration transaction rolls back and reports the failing version',
      wpRecord: '.agentdev/work/WP-01/test.md',
    },
    {
      file: 'packages/storage/test/migrations.integration.test.ts',
      title: 'migrations stops on a checksum mismatch instead of starting',
      rationale: 'a checksum error stops startup instead of migrating',
      wpRecord: '.agentdev/work/WP-01/test.md',
    },
    {
      file: 'packages/storage/test/migrations.integration.test.ts',
      title: 'migrations refuses a database written by a newer build',
      rationale: 'a newer-build database is refused instead of downgraded',
      wpRecord: '.agentdev/work/WP-01/test.md',
    },
    {
      file: 'packages/storage/test/migrations.integration.test.ts',
      title: 'migrations is idempotent on the second start',
      rationale: 'a second start performs no further migration work',
      wpRecord: '.agentdev/work/WP-01/test.md',
    },
    {
      file: 'packages/storage/test/migrations.integration.test.ts',
      title: 'migrations applies the core schema and records a checksum',
      rationale: 'the applied schema is recorded with its checksum',
      wpRecord: '.agentdev/work/WP-01/test.md',
    },
  ],
  'AC-066': [
    {
      file: 'packages/pi-runtime/test/session.integration.test.ts',
      title: 'Pi session lifecycle creates a session with the configured model and no network',
      rationale: 'session creation binds the configured model without network use',
      wpRecord: '.agentdev/work/WP-00/test-report.md',
    },
    {
      file: 'packages/pi-runtime/test/events.test.ts',
      title: 'SDK event mapping maps assistant text and thinking deltas',
      rationale: 'streaming deltas map onto the documented events',
      wpRecord: '.agentdev/work/WP-00/test-report.md',
    },
    {
      file: 'packages/pi-runtime/test/events.test.ts',
      title: 'SDK event mapping maps tool execution boundaries',
      rationale: 'tool boundaries map onto the documented events',
      wpRecord: '.agentdev/work/WP-00/test-report.md',
    },
    {
      file: 'packages/pi-runtime/test/session.integration.test.ts',
      title: 'Pi session lifecycle subscribes, unsubscribes and disposes',
      rationale: 'subscription and resource release follow the contract',
      wpRecord: '.agentdev/work/WP-00/test-report.md',
    },
    {
      file: 'packages/pi-runtime/test/session.integration.test.ts',
      title: 'Pi session lifecycle aborts an idle session without error',
      rationale: 'abort is part of the locked contract',
      wpRecord: '.agentdev/work/WP-00/test-report.md',
    },
    {
      file: 'packages/pi-runtime/test/session.integration.test.ts',
      title: 'Pi session lifecycle refuses to compact a session that has nothing to compact',
      rationale: 'compaction refuses an empty compaction instead of corrupting the session',
      wpRecord: '.agentdev/work/WP-00/test-report.md',
    },
    {
      file: 'packages/pi-runtime/test/session.integration.test.ts',
      title: 'Pi session lifecycle wires the resume path for a stored session file',
      rationale: 'session history recovery is wired against the locked SDK',
      wpRecord: '.agentdev/work/WP-00/test-report.md',
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
  'AC-092': [
    {
      file: 'packages/knowledge/test/requirements-pool.test.ts',
      title:
        'importRequirementPool imports a pool, is idempotent, and keeps local and record versions apart',
      rationale:
        'a second import writes nothing and the local version stays distinct from recordVersion',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
    {
      file: 'packages/knowledge/test/requirements-pool.test.ts',
      title:
        'parseRequirementPool keeps valid records visible next to a broken one and never rewrites the files',
      rationale: 'valid records stay visible beside a conflicted record without rewriting it',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
    {
      file: 'packages/knowledge/test/requirements-pool.test.ts',
      title:
        'importRequirementPool reports the same recordVersion with different content as a per-record conflict',
      rationale:
        'a same-version/different-content record becomes REQUIREMENT_CONFLICT instead of a silent overwrite',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
    {
      file: 'packages/knowledge/test/requirements-pool.test.ts',
      title:
        'importRequirementPool refuses to overwrite when Git moved but the projection is stale',
      rationale: 'a stale projection refuses the save instead of overwriting the newer Git record',
      wpRecord: '.agentdev/work/WP-08/test.md',
    },
    {
      file: 'packages/knowledge/test/requirements-pool.test.ts',
      title:
        'importRequirementPool conflicts per record when a local row has no readable Git record',
      rationale: 'a missing record is reported per record, not deleted',
      wpRecord: '.agentdev/work/WP-08/test.md',
    },
    {
      file: 'packages/knowledge/test/requirements-pool.test.ts',
      title:
        'importRequirementPool reports a duplicate id inside one batch instead of importing either copy',
      rationale: 'a duplicate id in one batch is reported instead of silently importing one copy',
      wpRecord: '.agentdev/work/WP-04/test.md',
    },
    {
      file: 'packages/knowledge/test/requirements-pool.test.ts',
      title:
        'importRequirementPool clears a conflict after Git is repaired and the record is re-imported',
      rationale: 'an explicit re-import after the Git repair clears the conflict',
      wpRecord: '.agentdev/work/WP-08/test.md',
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
    if (typeof evidence !== 'string' || evidence.trim().length === 0) {
      // Fail closed: a drill row without evidence text proves nothing (W10R1-11).
      problems.push(`${sourceFile}: drill row for ${id} carries no evidence text (ignored)`);
      return;
    }
    results.set(id, { status, evidence, sourceFile });
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
  const gap = RESIDUAL_GAPS[ac];
  if (gap !== undefined) return gap.gap;
  const hint = acceptanceCase?.evidence ?? '';
  if (/浏览器|截图|viewport|a11y/i.test(hint)) return ENVIRONMENT_REASONS.browser;
  if (/Provider|真实模型/.test(hint)) return ENVIRONMENT_REASONS.provider;
  return ENVIRONMENT_REASONS.generic;
}
