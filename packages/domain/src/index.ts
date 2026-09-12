/**
 * `@agentdev/domain` — state machines, gates, budgets and permission decisions.
 *
 * `ARCHITECTURE.md` §2 gives this package exactly one dependency (`contracts`),
 * and `data.md` §2 says the transitions themselves are owned by
 * `docs/rules/workflow.md`: "WorkStatus/RequirementState/TaskStage/RunStatus/
 * AttemptStatus/Phase枚举及转换以流程规则为唯一来源". This package implements
 * those transitions once so storage, core and clients cannot disagree.
 */
export * from './transitions.js';
export * from './delivery.js';
export * from './routing.js';
export * from './permission.js';
export * from './dispatch.js';
export * from './requirement.js';
export * from './requests.js';
