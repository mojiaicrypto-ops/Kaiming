import { MAX_ARRAY_ITEMS } from './primitives.js';

/**
 * Numeric baselines.
 *
 * `docs/architecture/ARCHITECTURE.md` §5 fixes these defaults and bounds, and
 * `docs/rules/agents.md` §6 fixes the context budgets. They are data, not
 * policy: the domain layer reads them, `config.update` validates against them,
 * and fixed constants must never become overridable
 * ("固定常量（如单写者）不能通过覆盖修改").
 */

/** A configurable value with its documented default and inclusive bounds. */
export interface LimitBounds {
  readonly default: number;
  readonly min: number;
  readonly max: number;
  /**
   * `true` when project config cannot override the value.
   *
   * `ARCHITECTURE.md` §5 names single-writer as an example of a fixed constant
   * rather than listing every one; entries whose documented value is a single
   * number (min = max) are marked fixed because no override could be valid.
   */
  readonly fixed: boolean;
  readonly note: string;
}

const limit = (
  value: number,
  min: number,
  max: number,
  note: string,
  fixed = false,
): LimitBounds => ({ default: value, min, max, fixed, note });

const BYTE = 1;
const KiB = 1024 * BYTE;
const MiB = 1024 * KiB;

/** Concurrency, budget, retry and queue limits (`ARCHITECTURE.md` §5). */
export const LIMITS = {
  globalConcurrentRunners: limit(8, 1, 32, 'Chief 优先预留 2 个槽'),
  projectConcurrentRunners: limit(4, 1, 16, '同 Project 至少预留 1 个 Chief 槽'),
  roleConcurrency: limit(2, 1, 8, '默认专业 Agent 并发'),
  taskWriterCount: limit(1, 1, 1, '固定单写者', true),
  workInputOutputTokens: limit(500_000, 1_000, 10_000_000, '所有子 Run 累计 token'),
  workActiveTimeSec: limit(7_200, 60, 86_400, '等待用户/权限不计，执行和模型等待计'),
  reviewRepairRounds: limit(3, 0, 10, '同 Task 失败后再开发计一轮'),
  // ARCHITECTURE.md §5: "providerRetries | 2 | 两次重试，退避2s/8s；仅可重试瞬时错误"
  // (a single documented value, so min = max = 2) and
  // "shellTimeoutSec | 120 | 单操作可授权到1800" (default 120, an operation Grant
  // may raise it to 1800; the lower bound is this implementation's choice, not a
  // documented number).
  providerRetries: limit(2, 2, 2, '退避 2s/8s；仅可重试瞬时错误', true),
  shellTimeoutSec: limit(120, 1, 1_800, '单操作可授权到 1800'),
  heartbeatSec: limit(5, 5, 5, '心跳间隔', true),
  leaseSec: limit(20, 20, 20, '超过 20s 未见心跳转 interrupted', true),
  cancelGraceSec: limit(10, 10, 10, 'SIGTERM 后 SIGKILL；总 60s 仍未知则 recovery', true),
  cancelUnknownDeadlineSec: limit(60, 60, 60, '取消后判定副作用未知的时限', true),
  idleSessionTtlSec: limit(300, 300, 300, '保存 Checkpoint 并退出 Runner', true),
  mailboxItems: limit(256, 256, 256, '超限返回 BUSY', true),
  mailboxBytes: limit(4 * MiB, 4 * MiB, 4 * MiB, '超限返回 BUSY', true),
  connectionQueueSoftBytes: limit(2 * MiB, 2 * MiB, 2 * MiB, '软限合并临时输出', true),
  connectionQueueHardBytes: limit(8 * MiB, 8 * MiB, 8 * MiB, '达硬限关闭慢连接', true),
  requestLimitBytes: limit(1 * MiB, 1 * MiB, 1 * MiB, '大文件走上传', true),
  eventRetentionDays: limit(30, 30, 30, '活动 Work 关键事件与全部未结算证据持续保留', true),
  outboxClaimLeaseSec: limit(30, 30, 30, 'Outbox claim lease', true),
} as const satisfies Record<string, LimitBounds>;

export type LimitName = keyof typeof LIMITS;

/**
 * Context budgets (`rules/agents.md` §6).
 *
 * effective = min(Profile.contextLimit, model.contextWindow - maxOutput - reserved).
 */
export const CONTEXT_LIMITS = {
  /** Profile default context limit in tokens. */
  profileDefaultTokens: 64_000,
  /** Startup package ceiling. */
  startupTokens: 24_000,
  /** Ceiling for additional reads inside one run. */
  expansionTokens: 16_000,
  /** Lowest settable context limit. */
  minTokens: 4_096,
  /** Highest settable context limit (still bounded by the model). */
  maxTokens: 2_000_000,
  /** Always reserved for the model's own output. */
  reservedTokens: 4_096,
} as const;

/** Initialization read budget (`product/knowledge.md` §5). */
export const INITIALIZATION_BUDGET = {
  maxBodyFiles: 40,
  maxBodyBytes: 512 * KiB,
  /** Directory/file name index entries; not counted as body files. */
  maxIndexEntries: 10_000,
} as const;

/** Attachment limits (`product/experience.md` §3). */
export const ATTACHMENT_LIMITS = {
  maxPerMessage: 5,
  maxBytesEach: 20 * MiB,
  maxBytesTotal: 50 * MiB,
  stagedTtlHours: 24,
} as const;

/** Artifact preview and download limits (`product/experience.md` §3, `execution.md` §6). */
export const ARTIFACT_LIMITS = {
  inlinePreviewMaxBytes: 1 * MiB,
  inlinePreviewMaxLines: 2_000,
  downloadTokenTtlSec: 60,
} as const;

/** Message and pagination limits (`architecture/protocol.md` §1/§3). */
export const PROTOCOL_LIMITS = {
  messageBodyMaxChars: 64_000,
  idempotencyKeyMinChars: 1,
  idempotencyKeyMaxChars: 128,
  defaultPageLimit: 50,
  maxPageLimit: 200,
  maxArrayItems: MAX_ARRAY_ITEMS,
} as const;

/** Authentication limits (`architecture/protocol.md` §2). */
export const AUTH_LIMITS = {
  sessionHours: 24,
  loginAttemptsPerIpPerMinute: 5,
} as const;

/** Reports whether a value sits inside its documented inclusive bounds. */
export function withinBounds(name: LimitName, value: number): boolean {
  const bounds: LimitBounds = LIMITS[name];
  return Number.isFinite(value) && value >= bounds.min && value <= bounds.max;
}
