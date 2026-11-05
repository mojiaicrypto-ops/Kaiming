# WP-12 收口：AC-046 生产 Join 触发点接线 + 容器探针暴露修复

- 状态：**开发完成并已用真实执行收口**；`w7-w3.md` §8 第 1 条（`permissions.integration.test.ts` 同一探针暴露）与第 4 条（`JoinCoordinator.onChildSettled` 无生产调用者）已关闭
- 范围：`packages/core/src/execution.ts`（接线）、`apps/daemon/test/assessment-dispatch.integration.test.ts`（新增 daemon 路径 join 演练）、`packages/core/test/join.integration.test.ts`（仅删除文件头的「触发点仍缺」说明）、`packages/core/test/permissions.integration.test.ts`（探针修复）
- 依据：`.agentdev/work/WP-12/w7-w3.md` §3/§8、`settlement.md` §4 第 6 条、`docs/rules/agents.md` §3、`docs/architecture/protocol.md` §6/§7、`docs/architecture/reliability.md` §2、`packages/core/src/join.ts`、`packages/core/src/supervisor.ts`（`onRunSettled`/`reportSettled`）
- 纪律：未改动任何被约束路径；未放宽任何断言；未新增运行时依赖；未 `git commit`；未入库任何负载脚本

---

## 1. Gap 1：生产 Join 触发点（真实产品接线缺口）

### 1.1 诊断

`JoinCoordinator.onChildSettled` 在 `packages/core/src/join.ts` 实现了 `agents.md` §3 的全部语义（`join=all` 子 Run 未全部终态 → 父 `waiting_children`；全部终态且无 required 失败 → 父回 `running`；required 失败 → 父保持阻断并写一次 `chief_action_required`，携带全部子结果），但 `grep JoinCoordinator` 显示**只有测试构造它**，生产栈里没有任何调用者。

真实栈里唯一观察「子 Run 到达终态」的位置是 `RunnerSupervisor` 的 `onRunSettled`（`supervisor.ts` 的 `reportSettled`，在 `finishFromResult` 结算之后、迟到结果路径上都会调用）。生产栈的 supervisor 在 `packages/core/src/execution.ts` 的 `createProjectExecution` 里组装，而同处已经把 daemon 的 `onRunSettled`（消息状态 + `plan.approve` 恢复）注入进去——接线缺口就在这里：原来的代码直接把 `options.control.onRunSettled` 透传，没有 Join。

### 1.2 修法（最小接线）

`packages/core/src/execution.ts`：

- `createProjectExecution` 构造**一个** `JoinCoordinator`（与 stack 共用同一个 `ProjectStore`/`lifecycle`）；
- supervisor 的 `onRunSettled` 改为**始终注入**的组合钩子：先 `joins.onChildSettled(input.runId)`，再调用 `options.control?.onRunSettled?.(input)`。
  - 非 Chief 父级/根 Run 由协调器自己判定（`orphan` / `NOT_AUTHORIZED`）：`orphan` 静默跳过，异常只记日志，**绝不**让 Join 的失败穿过 `reportSettled`（`supervisor.ts` 本身另有 try/catch，双保险）；
  - 触发时机是结算事务提交之后（`reportSettled` 在 `lifecycle.settle` 之后），Join 自己在 `withTransaction` 内重算，天然幂等（N-06）。

真实路径因此变为：

```text
Runner 子进程 attempt.result
  → supervisor.finishFromResult → lifecycle.settle(child)
  → supervisor.reportSettled(child) → onRunSettled（execution.ts 组合钩子）
      → JoinCoordinator.onChildSettled(child)
          ├─ 仍有 join=all 子 Run 未终态：父 running → waiting_children
          ├─ 全部终态、无 required 失败：父 waiting_children → running
          └─ required 子 Run 失败：父保持阻断 + 恰一次 chief_action_required（携带全部子结果）
      → daemon 原 onRunSettled（markMessageSettled / plan.approve 恢复）
```

`docs/rules/agents.md` §3 的「all 挂起该 ChiefRun 直至指定子 Run 终态」+ `protocol.md` §6/§7（`agent.dispatch`、`chief_action_required`）就是本接线的全部依据，**没有需要另行裁决的文档分歧**，故未停下询问。

### 1.3 整机演练（新增，走 daemon 路径）

`apps/daemon/test/assessment-dispatch.integration.test.ts` 新增 `join` 场景与用例
`wakes the parent Chief Run when a join=all child settles, through the daemon trigger (AC-046)`：

- 链路：真实 `conversation.message.send` → 真实 `openProject`/`createProjectExecution`（真 supervisor、真能力端点、真控制端点）→ 真实 `apps/runner` 子进程（脚本化模型，经 stdin/stdout 讲 `protocol.md` §6）→ 真实 `agent.dispatch` 派发**两个 `joinPolicy=all`、`requiredChild=true`** 的子 Run（`backend` 交付、`review` 只说话）；
- 断言（**没有任何测试代码调用协调器**）：
  - `review` 经真实两次不合规路径进入 `contract_violation`，`backend` 经真实 `stage.submit` 交付并 `completed`；
  - 父 Chief Run 由生产触发点从 `running` 变为 **`waiting_children`** 并保持（required 失败不得静默通过），且**没有** `run.ended`；
  - `chief_action_required` **恰一次**、`reason=required_child_failed`、`failed/failedRequired=[review]`，`data.children` 携带两个子 Run 且兄弟的 `stageResult.status=success/summary` 完整；
  - 库中兄弟 `stage_result` 仍为 1 行、失败子 Run 状态未被改写。
- **负例对照**：临时把 `execution.ts` 的 `joins.onChildSettled(...)` 换成不发 Join 的占位后，同一用例在 `waitFor`（等待 `waiting_children`）超时失败，exit 1；还原后通过。证明用例检测的正是缺的触发点，而不是别的时序。

### 1.4 文件头说明

`packages/core/test/join.integration.test.ts` 原文件头的「the *trigger* is still missing in the daemon」已删除，改为如实说明：该文件在服务层直接驱动协调器判定，**生产触发点已在 `execution.ts` 接通**，整机证据在 `apps/daemon/test/assessment-dispatch.integration.test.ts` 的 `join` 演练。库内断言未改。

---

## 2. Gap 2：`permissions.integration.test.ts` 的容器探针暴露

### 2.1 诊断

`packages/core/test/permissions.integration.test.ts` 的 `Broker` 原先裸构造（`new Broker({ store, grants, now: NOW })`），容器读用例（`keeps the frozen source read-only inside the real container`）因此走 Broker 的**每次调用** `docker version` 探针（`probeDockerAvailability`，15 s 预算）。探针迟到即 `PROVIDER_UNAVAILABLE`，**在容器执行之前**拒绝——与 `broker.integration.test.ts:505` 已登记的同一机制、同一失败行形状。模块级 `dockerStatus()` 只是 `spawnSync` 探测一次（无预算、无有界等待），只用于 `skipIf`，挡不住调用期探针。

### 2.2 修法（照搬已收口的诚实修法）

- 模块级改为 `measureDocker()`：用**产品自己的** `probeDockerAvailability(EXEC_IMAGE)` 测一次，只对 `ETIMEDOUT`（真正的负载条件）做**有界等待**（60 s 上限、1 s 间隔、每次都是真实探针），守护进程真下线时立即失败；镜像存在性仍用真实 `docker image inspect`。
- 这一次**真实量测**通过 Broker 的 `docker` 注入口交给 harness（`docker: () => DOCKER.availability`）；**容器执行仍是真 `docker run`**（读用例仍真实挂载冻结目录并断言文件内容），未改成 fake。
- 拒绝路径的确定性覆盖未动（`permissions-failures.test.ts` 的注入探针 + `apps/cli` doctor）。

### 2.3 A/B（受控慢探针，`/tmp` 一次性 PATH 外壳，未入库）

外壳只延迟第 2 次及以后的 `docker version` 调用 16 s（> 15 s 预算）：

| 变体 | 结果 | 探针调用数 |
|---|---|---|
| 去掉 `docker` 注入（原构造） | **FAIL** `:858 expect(verified.ok).toBe(true)`，17.82 s 后返回 `PROVIDER_UNAVAILABLE` | 2 |
| 保留注入（本次修法） | **PASS**，2.50 s，容器真实执行 | 1（只余那次真实量测） |

### 2.4 其它同类探针假设的排查

全仓 `docker version` / `probeDockerAvailability` 使用点已逐个核对：

- `packages/core/test/broker.integration.test.ts`：上一任务已修（量测 + 注入），本次复跑通过；
- `packages/core/test/tool-http.integration.test.ts`：Broker 在 `beforeEach` 里已注入 `docker: () => ({ available: true, … })`，容器用例的调用期**不会**走到真实探针；模块级 `probeDockerAvailability` 只用于 `skipIf`，慢探针最坏表现为**跳过**而非失败。不是同一暴露，未改（若要把跳过也消除，可同样改为有界量测，但那属于测试覆盖率增强而非本缺口）；
- `packages/core/test/broker.test.ts`、`permissions-failures.test.ts`：单元工程，均注入确定性探针。

结论：真正带「调用期探针」暴露的只剩 `permissions.integration.test.ts`，已修。

---

## 3. 本次运行内证据

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0（含对 `assessment-dispatch.integration.test.ts` 的 Prettier 归一） |
| `pnpm test:unit` | 77 文件 / **1432 用例全通过**，exit 0 |
| `pnpm test:integration`（全量串行） | 56 文件 / **523 用例全通过**，exit 0（原 56/522，+1 为本任务新增的 join 整机用例） |
| join 整机演练（`-t "wakes the parent Chief Run"`） | **5/5 通过**，exit 0，load 300→307（叠加 16 个忙循环；基线本身已有 Docker VM ~470% CPU / load ~200） |
| join 整机演练负例（触发点占位） | `waitFor` 超时失败，exit 1（证明用例检测缺的触发点） |
| permissions 容器读（`-t "keeps the frozen source read-only"`） | **5/5 通过**，exit 0，load 238→309 |
| permissions 慢探针 A/B | 去注入 FAIL `:858`（17.82 s / 2 次探针）；注入后 PASS（2.50 s / 1 次探针） |
| `node scripts/acceptance.mjs`（真实 Provider，`/tmp/wp12-live.env`） | **`94/94 ACs accounted — PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0`**，`OK — every AC is PASS or a registered, condition-checked accepted gap`，**exit 0**；`problems=[]`、`drillsExecuted=true`、`providerConfigured=true`、`reviewModelConfigured=true`；AC-046 证据 16 条，含 `join.integration.test.ts` 与新增 `assessment-dispatch.integration.test.ts :: … wakes the parent Chief Run …`，两条均 `mapping=test-name`、无 gap；密钥出现次数 0 |
| `pnpm docs:check` | `docs:check ok — 16 documents, 67 internal links, 94 acceptance cases, 9 requirements, 11 work packages`，exit 0 |

验收运行按当前树重新绑定并覆写 `.agentdev/work/WP-12/acceptance.md`、`acceptance-results.json`（`gitDirty=true`，工作树含本任务改动）。

---

## 4. 如实边界与未决问题

1. **Join 触发点已接、Chief 的自动续跑未接（并有文档依据）**：触发点只做文档化的状态迁移与待办。`join=all` 全部成功后父 Run 回到 `running`，但不会自动开新 Attempt 去让 Chief 继续产出——`agents.md` §3 明确「Chief 新的对话 Run 独立于正在等待的父 Run」，即继续由下一次 Chief 指令驱动，而不是自动唤醒。若产品希望「最后一个 `join=all` 子 Run 成功即自动续跑父 Chief」，那是一个**新的产品决定**（需要在父 Run 上开新 Attempt、定义 resume 语义），本次未实现、未猜测。
2. **`join=all` required 失败时源消息停留 `processing`**：由 `RunLifecycle` 的 `completed` 守卫（活 `join=all` 子 Run 存在时拒绝）与「`waiting_children` 非终态」共同导致，是接线前就存在的行为，非本次回归；可行动信号是 `chief_action_required` 待办。是否要把消息推进到某个「阻断」状态需要产品先定义该状态（现有 `Message` 状态机没有），本次不动。
3. **合成负载不是 Docker VM 的真实压力**：本机 Docker Desktop VM 长期 ~470% CPU、load ~200 已构成登记条件；仍无法证明「自然负载必翻转」，所以 Gap 2 用受控慢探针做机制级 A/B，配合负载下的重复通过。
4. **`tool-http.integration.test.ts` 的 `skipIf` 探针**：慢探针下会跳过而非失败（见 §2.4），未改；如需彻底消除覆盖损失，可同样改为有界量测。

## 5. 工作树

- 未提交任何负载生成脚本或慢探针外壳（`/tmp` 内一次性创建并回收）；未产生 `zz-` 临时测试文件。
- 本次改动：`packages/core/src/execution.ts`、`apps/daemon/test/assessment-dispatch.integration.test.ts`、`packages/core/test/join.integration.test.ts`、`packages/core/test/permissions.integration.test.ts`；另由验收运行重新生成 `acceptance.md`/`acceptance-results.json`。
