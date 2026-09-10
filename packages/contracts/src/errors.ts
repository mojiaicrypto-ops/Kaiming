/**
 * Protocol error codes.
 *
 * The code set, its meaning and retryability come from
 * `docs/architecture/protocol.md` §7 (plus the requirement-specific codes in
 * §8 and `docs/product/requirements.md`). Only `BUSY` and known
 * side-effect-free provider failures are retryable:
 * "仅BUSY和已知无副作用的Provider瞬时错误retryable=true".
 */
import { z } from 'zod';

/** Every error code a client may receive. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'INVALID_STATE',
  'UNAUTHENTICATED',
  'AUTH_EXPIRED',
  'NOT_FOUND',
  'NOT_AUTHORIZED',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'GATE_NOT_READY',
  'MISSING_CONTEXT',
  'CONTEXT_FORBIDDEN',
  'STALE_ARTIFACT',
  'BUDGET_EXCEEDED',
  'BUSY',
  'RECOVERY_REQUIRED',
  'ATTACHMENT_ALREADY_BOUND',
  'ARTIFACT_MISSING',
  'KNOWLEDGE_INVALID',
  'PROVIDER_UNAVAILABLE',
  'PROTOCOL_MISMATCH',
  'RESYNC_REQUIRED',
  'INTERNAL_ERROR',
  'REQUIREMENT_CONFLICT',
  'REQUIREMENT_PATH_IGNORED',
  'LEGACY_REQUIREMENT_FORMAT',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export interface ErrorCodeSpec {
  /** `true` only when retrying the same request is known to be safe. */
  readonly retryable: boolean;
  /** What the caller/user should do next. */
  readonly remediation: string;
}

/** Per-code retryability and next step. */
export const ERROR_SPECS: Record<ErrorCode, ErrorCodeSpec> = {
  VALIDATION_ERROR: { retryable: false, remediation: '修正输入' },
  INVALID_STATE: { retryable: false, remediation: '当前实体状态不允许该操作' },
  UNAUTHENTICATED: { retryable: false, remediation: '重新认证' },
  AUTH_EXPIRED: { retryable: false, remediation: '重新认证' },
  NOT_FOUND: { retryable: false, remediation: '核对目标 ID 与 Project 范围' },
  NOT_AUTHORIZED: { retryable: false, remediation: '取得有效 Grant' },
  VERSION_CONFLICT: { retryable: false, remediation: '读取并重评，禁止盲改版本重发' },
  IDEMPOTENCY_CONFLICT: { retryable: false, remediation: '读取并重评，禁止盲改版本重发' },
  GATE_NOT_READY: { retryable: false, remediation: '由 Chief 处理阶段前置' },
  MISSING_CONTEXT: { retryable: false, remediation: '由 Chief 补齐上下文' },
  CONTEXT_FORBIDDEN: { retryable: false, remediation: '由 Chief 处理越权来源' },
  STALE_ARTIFACT: { retryable: false, remediation: '重建证据' },
  BUDGET_EXCEEDED: { retryable: false, remediation: '由用户调整预算' },
  BUSY: { retryable: true, remediation: '未接受，可退避重发同幂等键' },
  RECOVERY_REQUIRED: { retryable: false, remediation: '检查后由用户决定处置' },
  ATTACHMENT_ALREADY_BOUND: { retryable: false, remediation: '重新上传附件' },
  ARTIFACT_MISSING: { retryable: false, remediation: '修复来源' },
  KNOWLEDGE_INVALID: { retryable: false, remediation: '修复来源' },
  PROVIDER_UNAVAILABLE: {
    retryable: false,
    remediation: '检查配置或恢复 Provider；仅已知无副作用的瞬时错误才可重试',
  },
  PROTOCOL_MISMATCH: { retryable: false, remediation: '升级客户端' },
  RESYNC_REQUIRED: { retryable: false, remediation: '重新快照订阅' },
  INTERNAL_ERROR: { retryable: false, remediation: '保存 operationId 诊断' },
  REQUIREMENT_CONFLICT: { retryable: false, remediation: '修复 Git 记录后显式重新导入' },
  REQUIREMENT_PATH_IGNORED: { retryable: false, remediation: '修正 Git ignore 规则' },
  LEGACY_REQUIREMENT_FORMAT: { retryable: false, remediation: '显式转换并校验旧格式' },
};

/** Wire shape of a failed response body. */
export const errorBodySchema = z.strictObject({
  code: errorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  details: z.unknown().optional(),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

/**
 * Codes whose retryability depends on the situation rather than the code.
 *
 * `protocol.md` §7 allows retrying a provider failure only when it is *known*
 * to be a transient error with no side effects, so the caller must say so.
 */
export const CONDITIONAL_RETRYABLE_CODES = ['PROVIDER_UNAVAILABLE'] as const;

/** Context the caller must supply for a conditionally retryable code. */
export interface RetryContext {
  /** The provider failure is known to be transient and side-effect free. */
  readonly providerTransient?: boolean;
}

/**
 * `true` only when retrying the same request is known to be safe.
 *
 * The static `ERROR_SPECS[code].retryable` flag is the unconditional answer;
 * callers that can tell a transient, side-effect-free provider failure apart
 * must call this function with `providerTransient` instead of reading the flag.
 */
export function isRetryable(code: ErrorCode, context: RetryContext = {}): boolean {
  if (code === 'BUSY') return true;
  if ((CONDITIONAL_RETRYABLE_CODES as readonly string[]).includes(code)) {
    return context.providerTransient === true;
  }
  return false;
}
