/**
 * Per-AC evidence-level classification (WP-12 W9).
 *
 * `WP-12/test.md` §3.7 found that the acceptance report listed *which* cases prove an
 * AC but never said *at what level*: 94 PASS rows read as "94 product-path proofs"
 * while roughly half rest on library-level cases that cannot fail for a product reason.
 * This module classifies every aggregated AC from the evidence the run actually
 * produced — nothing is hand-listed per AC.
 *
 * ## Levels
 *
 * - `product-path` — a product surface really executed: an executed case under
 *   `apps/**\/test/**` (real daemon/BFF/Runner/CLI stack; the layer definition
 *   `api-gap-audit-2.md` §4 and `test.md` §3.7 both use) or a per-AC `PASS` row from a
 *   real release drill (`pnpm test:e2e` = real daemon + real Runner child + real
 *   Chromium; `pnpm test:live` = real Provider).
 * - `library-level` — only library/page-level cases (or a planted-seed application row,
 *   see `SEEDED_EVIDENCE_ACS`). `test.md` §3.7's own reading: this is the *correct*
 *   level for a rule whose truth is a Core/domain rule, but it must not be reported as
 *   a product-path proof.
 * - `environment-limited` — the AC is UNVERIFIED under a registered accepted gap whose
 *   condition is an environment input this machine cannot supply (no Provider, no
 *   distinct Review/Test model, no browser). Only reachable while that condition holds.
 * - `unclassified` — no executed suite evidence and no executed drill row at all. The
 *   report must surface it rather than guess a level.
 *
 * ## Deliberately derived, not guessed
 *
 * The classification reads `result.evidence[].file`, `result.drills[]` and
 * `RESIDUAL_GAPS[].condition` from the same run that produced the verdict. The two
 * hard-coded sets below are *recorded facts from repository documents*, not opinions:
 *
 * - `SEEDED_EVIDENCE_ACS` — `api-gap-audit-2.md` §5-B and `T5-plan.md` §E12 record that
 *   AC-087/088/089's only application-level evidence reads from `seedRequirement(...)`
 *   rows written directly into the database, not from the real `import`/`clone` product
 *   path. Counting that row as `product-path` would recreate the over-claim W9 removes.
 * - `argumentative` notes name where a classification could reasonably be read the other
 *   way, so the record is auditable instead of authoritative-sounding.
 */
import { RESIDUAL_GAPS } from './drill-acs.mjs';

/** Every level this module can return, in report order. */
export const EVIDENCE_LEVELS = Object.freeze([
  'product-path',
  'library-level',
  'environment-limited',
  'unclassified',
]);

/** Human labels used in the markdown report. */
export const EVIDENCE_LEVEL_LABELS = Object.freeze({
  'product-path': 'product-path（产品路径）',
  'library-level': 'library-level（库级）',
  'environment-limited': 'environment-limited（环境受限）',
  unclassified: 'unclassified（未分类）',
});

/** Drills that execute a real product surface (daemon/CLI/browser/real Provider). */
const REAL_DRILLS = new Set(['pnpm test:e2e', 'pnpm test:live']);

/** Executed application-layer tests: a real daemon/BFF/Runner/CLI surface. */
const APP_TEST = /^apps\/[^/]+\/test\//u;

/** Executed package-level tests: Core/domain/storage/workspace/knowledge/pi-runtime. */
const PACKAGE_TEST = /^packages\/[^/]+\/test\//u;

/**
 * ACs whose only application-level evidence is a planted-seed row.
 *
 * Recorded in `api-gap-audit-2.md` §4/§5-B ("应用层(播种行)") and T5-plan §E12; the
 * commands and gates under test are real, the *inputs* are inserted directly rather
 * than produced by the documented `clone → open → import` path.
 */
const SEEDED_EVIDENCE_ACS = new Set(['AC-087', 'AC-088', 'AC-089']);

/** Short description of an environment condition. */
function conditionLabel(condition) {
  if (condition === 'provider-absent') return '未配置真实 Provider（AGENTDEV_PROVIDER_*）';
  if (condition === 'review-model-absent') return '未配置独立 Review/Test 模型';
  if (condition === 'browser-absent') return '本机没有可运行的 Playwright/Chromium';
  return String(condition);
}

/**
 * Classifies one aggregated AC result.
 *
 * @param {object} result an `aggregateAcceptance` result, already annotated with
 *   `accepted` by `scripts/acceptance.mjs`
 * @returns {{
 *   level: 'product-path'|'library-level'|'environment-limited'|'unclassified',
 *   reason: string,
 *   arguable: boolean,
 *   notes: string[],
 * }}
 */
export function classifyEvidenceLevel(result) {
  const registration = RESIDUAL_GAPS[result.id];
  const condition = registration?.condition ?? null;
  const suiteFiles = result.evidence.map((entry) => entry.file);
  const appEvidence = suiteFiles.filter((file) => APP_TEST.test(file));
  const packageEvidence = suiteFiles.filter((file) => PACKAGE_TEST.test(file));
  const passDrills = result.drills.filter(
    (drill) => REAL_DRILLS.has(drill.tool) && drill.status === 'PASS',
  );
  const executedDrills = result.drills.filter(
    (drill) => drill.status === 'PASS' || drill.status === 'FAIL',
  );

  // An accepted environment gap means the AC's remaining half genuinely could not run
  // here; the aggregator only marks `accepted` while that condition still holds.
  if (result.accepted === true && condition !== null && condition !== 'recorded-gap') {
    return {
      level: 'environment-limited',
      reason: `本次运行缺少该 AC 需要的一半输入（${conditionLabel(condition)}）${
        suiteFiles.length > 0 ? `；其余 ${suiteFiles.length} 条已执行证据为库级/应用层` : ''
      }`,
      arguable: false,
      notes: [],
    };
  }

  const seeded = SEEDED_EVIDENCE_ACS.has(result.id);
  if (!seeded && (appEvidence.length > 0 || passDrills.length > 0)) {
    const reasons = [];
    if (appEvidence.length > 0) reasons.push(`apps 层已执行证据 ${appEvidence.length} 条`);
    if (passDrills.length > 0) {
      reasons.push(`真实演练 ${passDrills.map((drill) => drill.tool).join('/')} PASS`);
    }
    const notes = [];
    if (appEvidence.length === 0) {
      notes.push(
        '唯一产品路径证据来自演练：该演练不在提交套件内，回归时不会自动重放（api-gap-audit-2 §5-C）',
      );
    }
    return {
      level: 'product-path',
      reason: reasons.join('；'),
      arguable: notes.length > 0,
      notes,
    };
  }

  if (seeded) {
    return {
      level: 'library-level',
      reason:
        'apps 层用例的关键断言读自播种行（seedRequirement 等直插行），不是真实 import/clone 产品路径',
      arguable: true,
      notes: ['登记于 api-gap-audit-2 §4/§5-B 与 T5-plan §E12（"应用层证据只有播种行"）'],
    };
  }

  if (suiteFiles.length > 0) {
    const detail = [
      packageEvidence.length > 0 ? `packages/* 库级 ${packageEvidence.length} 条` : null,
      appEvidence.length > 0 ? `apps 层非集成用例 ${appEvidence.length} 条` : null,
    ]
      .filter((part) => part !== null)
      .join('，');
    return {
      level: 'library-level',
      reason: `只有库级/页面级已执行证据（${detail}）；该规则的正确验证层级即为库级`,
      arguable: false,
      notes: [],
    };
  }

  if (executedDrills.length > 0) {
    return {
      level: 'product-path',
      reason: `演练已执行并报告 ${executedDrills
        .map((drill) => `${drill.tool}=${drill.status}`)
        .join('、')}`,
      arguable: true,
      notes: ['该 AC 没有提交套件证据，产品路径结论完全来自演练行'],
    };
  }

  return {
    level: 'unclassified',
    reason: '既没有已执行的提交套件证据，也没有已执行的演练行',
    arguable: true,
    notes: ['无法从本次运行的证据推导层级，需人工判定'],
  };
}

/**
 * Counts the levels of every classified AC.
 *
 * @param {object[]} results results carrying `evidenceLevel`
 * @returns {Record<string, number>}
 */
export function summarizeEvidenceLevels(results) {
  const counts = {};
  for (const level of EVIDENCE_LEVELS) counts[level] = 0;
  for (const result of results) {
    const level = result.evidenceLevel ?? 'unclassified';
    counts[level] = (counts[level] ?? 0) + 1;
  }
  return counts;
}

/** One-line summary for the console. */
export function formatEvidenceLevels(counts) {
  return EVIDENCE_LEVELS.map((level) => `${level} ${String(counts[level] ?? 0)}`).join(' / ');
}
