# Plan — 委派等待的配置阻断与停止响应

日期：2026-11-27
用户现场：prepdex `developer` 仍指向不可用模型时，主管的 `task(op=dispatch)` 等待子成员；子成员输入保持 queued，主管看不到原因并在 `settleStep` 中等待超时；用户点停止后，主管输入仍为 processing，stop RPC 直到子成员完成才返回。
验证档位：`focused`（`settleStep` 的局部等待行为与一个定向回归测试；不跑全量套件）

## 目标

1. 子成员因 `MODEL_UNAVAILABLE` 无法启动时，主管的当前 dispatch 等待立即以结构化 `blocked` 返回，不被当成普通 queued 成员等到 deadline；子成员输入仍保留 queued，模型配置修复后 worker 可继续，不伪造终态。
2. 主管输入收到停止请求时，`settleStep` 立即结束等待并返回 `stopped`，不依赖子成员完成或 1 小时 deadline；停止后的输入行和 stop 请求都能正常落地。
3. 未改变的正常等待、超时快照和成员完成路径保持原行为。

## 范围

- `kaiming/src/runtime/runner.ts`：`settleStep` 在轮询中识别主管 stopRequestKey；对 queued 当前成员解析有效配置并查询 `factory.isAvailable`，不可用时返回 `blocked`，在 `MemberState.error` 中给出 `MODEL_UNAVAILABLE`。
- `kaiming/src/tools/delegation-tools.ts`：`DelegationReturn.outcome` 增加 `stopped`，供停止的等待明确返回。
- `kaiming/test/runtime.test.ts`：新增两个真实 Pi 工具循环用例：
  - 不可用成员模型 → `blocked`、`MODEL_UNAVAILABLE`、输入仍 queued、耗时远小于 dispatch 超时；
  - 主管等待期间 stop → `stopped`、主管输入 stopped、耗时远小于 timeout。
- 文档：`docs/technicalnew/messaging-and-collaboration.md` 的 `DelegationReturn` 契约；`docs/technicalnew/runtime-contract.md` 的配置不可用/停止等待说明；`docs/technicalnew/validation.md` 记录本轮证据。

## 非目标

- 不把 queued 子成员改成 failed/blocked 终态；不自动重启或替换成员 Session。
- 不增加新 Store schema、Task 阶段、UI 页面或全量/跨模块 E2E。
- 不改变主管正常等待、成员报告、现有 watchdog 计费或子成员自身的停止语义。

## 验收

1. 当当前步骤存在 queued 成员且其有效 provider/model 不可用时，`task(op=dispatch)` 返回的 `sessions` 中该成员 error.code 为 `MODEL_UNAVAILABLE`，outcome 为 `blocked`；该成员输入仍是 `queued`。
2. 该返回在 dispatch 的 `waitTimeoutMs` 之前发生；不会静默等到 deadline。
3. 主管输入被 stop 后，`settleStep` 在轮询周期内返回 `stopped`；主管输入最终为 `stopped`，不等待子成员完成。
4. 具有可用模型的 queued 成员仍按现有 timeout/completion 逻辑等待，不被误报为 blocked。
5. `npx vitest run test/runtime.test.ts` 与 `npm run typecheck` 通过；只运行该 focused 范围。

## 风险与决定

- 配置可用性查询在 25ms 轮询内执行；`isAvailable` 只读取 SDK 可用快照，配置 mtime/size 变化才刷新，不引入网络探测。
- 返回 `stopped` 是工具结果层的新 outcome 值，需同步技术契约；不会改写 Task 状态。
- 当前运行中的 workbench 不在本 Task 重启；代码在下次启动生效。
