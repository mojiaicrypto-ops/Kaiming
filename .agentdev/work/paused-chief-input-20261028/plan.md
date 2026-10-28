# Plan: 暂停 Task 时主管自身的对话输入必须可执行

Task: `paused-chief-input-20261028`
状态: Developing（用户明确授权“按照上面的想法修复”＝采纳 `storage-and-recovery.md` S3 已写明的契约，未新增产品行为）

## 1. 问题与依据

**现象（实测）**：会话 `s-951d407099a4`（chief）的全部输入停在 `queued`。DB 事实：`t-b41cb0ec.status=paused`，`session_inputs.c-mvrpgbc4-25-271cab` `status=queued`、`claim=0`、`serverEpoch=NULL`；全库无 `processing` / `interrupted`。临时库复现：Task `paused` 时 `claimNextInput` 返回 `{"kind":"controlled","code":"TASK_CONTROLLED"}`，输入保持 `queued`。

**根因**：`src/store/store.ts:1418-1436`。`claimNextInput` 只看 Task 状态与 `task_sessions` 的 `investigator + expectedKind=recovery` 例外；chief 自身输入（`task_sessions` 无行 → `roleId=null`）在 Task 暂停时一律 `controlled`。`src/runtime/runner.ts:265` 原样返回，`src/server/worker.ts` 不推进，会话永久冻结。

**契约依据**：`docs/technicalnew/storage-and-recovery.md`

- :91 `chief 自身已停稳且无未核实中断时，Task 暂停不阻止其状态/控制/恢复输入；项目写 op 仍拒绝`
- :125 `pause 保留 queued`；`resume` 才让成员工作可消费（本 Plan 不改）
- :129 停止源输入/暂停 Task 使 pending 交互 stale（已有行为，不改）

**缺口二**：暂停期间禁止“项目写 op”没有实现。表现为 `src/runtime/tool-sets.ts` 仍给 chief 完整 `bash` + `requirement`/`project`；`task-tools.ts` 文内注明 resume 状态下 `*_op` 被拒（G2），但暂态没有程序守卫。

## 2. 目标与验收

| # | 可观察结果 | 验证方式 |
|---|---|---|
| A1 | Task 为 `paused` 且该会话是 chief、自身无 processing/interrupted 时，chief 的 user/system_notice 输入被 claim（`processing`），随后正常结束 | 新增 store 单元测试 + 现有 runtime 测试 |
| A2 | 同一 `paused` Task 下，成员（非 recovery 的 investigator / developer 等）输入仍 `controlled` | 现有 `test/delegation.test.ts:208/527/569`、`test/runtime.test.ts:1376` 不放松 |
| A3 | 会话存在 `interrupted` 输入时，仍返回 `blocked/RECOVERY_REQUIRED`（S3 首条） | 现有 claim 测试 |
| A4 | `pausing` / `cancelling` / `cancelled` 下 chief 输入仍不被消费 | 新增测试 |
| A5 | 暂停期间 `write`/`edit`/`bash`/`requirement`/`project` 不进入 chief 的 tool set，`resume` 后恢复 | 新增 `tool-sets` 测试 |
| A6 | 暂停期间 chief 读取 `task` 工具时看到“写 op 拒绝 / 续接需 resume”的事实，而不是无声降权 | 新增 guidance 测试 |

## 3. 范围

**范围内**

1. `src/store/store.ts` `claimNextInput`：非运行 Task（`pausing`/`paused`）下，若候选输入的会话就是该 Task 的 `chiefSessionId`，且输入 `kind` 为 `user`/`system_notice`，按普通输入 claim（不进入 recovery 例外分支）。
2. `src/runtime/tool-sets.ts`：新增“Task 暂态”入参，产出暂停期的 chief tool set（`NATIVE` 去掉 `write`/`edit`/`bash`，`DOMAIN` 去掉 `requirement`/`project`）。
3. `src/runtime/runner.ts`：按该 session 当前 Task 状态选择 tool set（不改变已实现的 read/write 选择）。
4. `src/tools/task-tools.ts` + `src/tools/guidance.ts`：`task(op=get)` 的 guidance 在 Task 暂停时给出“写 op 被拒、resume 才能续接”的事实；`task(op=control, command=resume)` 保持可用。
5. 测试：`test/store.test.ts`、`test/runtime.test.ts`、`test/tool-sets.test.ts`、`test/task-tools.test.ts`。

**范围外**

- 不加“暂停时自动恢复”、不改前端（`TaskStrip` 已有 Resume 按钮）。
- 不改成员 `controlled` 语义、不改 `pause` 保留 `queued` 的存储行为。
- 不进入现场 `devagent/.agentdev-data` 数据库（修好后由用户点 Resume 解开，无需回填）。
- 不动 `tool-guard.ts` 的私有目录校验。

## 4. 实施步骤

| 步骤 | 负责 | 变更 | 路径 | 自检 |
|---|---|---|---|---|
| S1 | developer | 认领：chief 自身输入在 `pausing`/`paused` 下可消费；其余状态与成员不变 | `src/store/store.ts` | `npm test -- store` |
| S2 | developer | tool set：`toolSetFor(roleId, taskType, hold?)`；`hold='paused'` 时 chief 无写权限；调用点按当前 Task 状态传入 | `src/runtime/tool-sets.ts`, `src/runtime/runner.ts` | `npm test -- tool-sets` |
| S3 | developer | 可发现性：暂停 Task 的 `task(op=get)` guidance 说明只有 resume 能继续，写 op 被拒 | `src/tools/task-tools.ts`, `src/tools/guidance.ts` | `npm test -- task-tools` |
| S4 | developer | 回归：真 Story 级测试——paused Task + chief input 经 `runNext` 真跑到 `completed` | `test/runtime.test.ts` | `npm test -- runtime` |

## 5. 验证

- `cd devagent && npm run typecheck && npm test`
- 独立 Test 需在真实服务上走一条：造 paused Task 的会话（临时 dataDir 起服务），提交输入 → 观察 `processing` → `completed`；再用浏览器/浏览器不可用时至少 `curl` 走 `task.control resume`。
- 现场库只在用户同意后由用户点 Resume 解开（Plan 不触碰 `.agentdev-data`）。

## 6. 审核重点与风险

- **风险 1 越权**：允许 chief 输入被消费 ≠ 允许项目写入。必须同时落 S2，否则契约后半句被破坏。
- **风险 2 认领放宽过头**：只限 `chiefSessionId` 相等且 `kind in (user, system_notice)`；其它 kind（delegation/continuation）与成员会话不变。
- **风险 3 状态机**：`pausing` 保留放宽（暂停请求已收到但还有成员在停）；`cancelling`/`cancelled` 不放宽，避免取消中的写入竞态。
- **风险 4 工具集缓存**：tool set 在每次 claim 时解析，不得跨输入缓存 `paused` 判定。
- **回滚**：三处独立提交边界（S1 / S2 / S3+测试），任一可单独 revert。

## 7. 回滚

`git revert` 本次提交即可；无数据迁移，无 schema 变更。
