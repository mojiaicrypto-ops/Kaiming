# Implementation — 委派等待的配置阻断与停止响应

日期：2026-11-27
验证档位：`focused`

## 实际改变

### `kaiming/src/runtime/runner.ts`

- `settleStep` 在每次轮询先读取当前主管 live input 的 `stopRequestKey`；命中时返回 `stopped`，并保留成员快照。
- 新增 `unavailableMember`：只检查当前步骤中 `queued` 的成员，按 Task 的 `projectId` 与成员 role 解析有效配置，调用 `PiRuntimeFactory.isAvailable`。不可用时返回 `blocked`，在该成员 `MemberState.error` 写入 `MODEL_UNAVAILABLE`，不修改输入状态。
- 原 queued/working/waiting_user/stopping、完成与 timeout 分支保持不变。

### `kaiming/src/tools/delegation-tools.ts`

- `DelegationReturn.outcome` 增加 `stopped`；`task(op=dispatch)` 可把停止等待明确返回给主管。

### Tests

- `kaiming/test/runtime.test.ts` 的 harness 增加 `modelForRole`，仅用于测试让 developer 使用不可用模型。
- 新增 3 个用例：
  - 不可用成员模型：dispatch 在 2s 内返回结构化 `blocked`（事件包含 `t-blocked blocked`），错误为 `MODEL_UNAVAILABLE`，成员输入仍 `queued`。
  - 主管等待中 stop：主管输入最终 `stopped`，stop 调用在 2s 内返回，事件包含 `t-stop stopped`，成员输入仍 queued，不等待 20s timeout。
  - 可用成员控制：queued 成员模型可用时返回 `timeout`，不出现 `MODEL_UNAVAILABLE`，成员仍 queued。

### Docs

- `docs/technicalnew/messaging-and-collaboration.md`：`DelegationReturn` 与等待事实表。
- `docs/technicalnew/runtime-contract.md`：模型不可用与停止等待的行为。
- `docs/technicalnew/validation.md`：本次问题、实现、证据与边界。

## 未改变

- 不把 queued 成员改成 failed/blocked 终态；配置修复后 worker 仍可继续同一输入。
- 不新增 Store schema、Task 状态、UI、全量套件或 E2E。
- 当前运行中的 workbench 没有重启；代码只在下次启动生效。
