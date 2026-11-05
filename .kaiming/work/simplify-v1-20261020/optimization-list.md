# v1 流程简化 · 优化列表

日期:2026-10-20。范围:模型可见的协议与文档;产品承诺不变。

## 决定(已确认)

| # | 决定 | 依据 |
|---|---|---|
| D1 | 顺序执行:一个主管 Session 同时只推进一项 Task;一个 Task 的当前步骤一次只由一个写者改同一份文件 | 实测历史:流程工具错误率 28.5%,执行工具 1.5% |
| D2 | 模型不携带任何版本/令牌:revision、文件摘要、candidateId、计划版本、报告版本全部移出模型工具参数 | 单写者,并发写不存在;令牌只造成重试 |
| D3 | 删除「候选冻结」概念;复核/测试绑定由程序在报告提交时记录交付状态,完成时比较 | 产品从未要求候选概念;technicalnew 才引入 |
| D4 | v1 支持同一 Task 内并行子 Session(含写工作,按模块);写成员声明 `writeScope`,程序只告警重叠,不拦截 | 用户决定 B |
| D5 | v1 不做并行多个 Task 的独立 git worktree;后续版本再引入 | 用户决定 |
| D6 | 报告 kind 由派发时的 expectedKind 决定;模型不再声明 | 实测 21 次类型不匹配错误 |
| D7 | 工具表面收敛:5 个领域工具(task / agent_report / requirement / project / question) | 现状 10 个 |

## 一、文档(本轮已完成)

| 文件 | 改动 |
|---|---|
| `technicalnew/agents-and-tools.md` | G1 工具表;G2 重写为 5 工具:`task`(create/update/dispatch/control/end/get/adopt/recover)、`agent_report`、`requirement`、`project`、`question`;删除 prepare_candidate、candidateId、revision、expectedVersion、reportRef、supersedes、kind;新增 writeScope 与重叠告警;G3 改为「交付状态由程序绑定」 |
| `technicalnew/requirements-format.md` | F4 删除 expectedVersion;改为程序记录「本会话上次读到什么」;删除 CAS 表述 |
| `technicalnew/architecture.md` | A5 并行规则:同 Task 内按模块并行 + writeScope;Review/Test 针对当前工作树 |
| `technicalnew/storage-and-recovery.md` | tasks/task_sessions/results 字段;删除 Candidate;file_saves observedVersion;S6 报告 body;S7 recover;并行写入规则 |
| `technicalnew/runtime-contract.md` | 错误码去掉 REPORT_STALE;候选/版本表述移除(宿主 RPC 的 expectedRevision 保留) |
| `technicalnew/messaging-and-collaboration.md` | 图与表格改为 task(op=...);delegation 参数去 candidateId |
| `technicalnew/implementation-checks.md` | REL-07/08/15 改为交付状态语义 |
| `technicalnew/validation.md` | 去候选/冻结版本表述 |
| `technicalnew/prompts/*.md` | base/chief/designer/reviewer/tester/settler/specialists:工具名、候选、版本、prepare_candidate、reportRef、reconcile |
| `productnew/modules/delivery.md` | D-03 并行规则(同 Task 按模块 + writeScope + 告警;worktree 后续);D-04 去掉「版本」与工具名 |
| `productnew/modules/requirements.md` | 去掉「工具校验版本」 |
| `productnew/acceptance.md` | 去掉工具名 updateTask |

### 文档一致性检查

- `grep -rn "createTask|updateTask|endTask|createTaskSessions|prepare_candidate|task.get|task.reconcile|candidateId|reportRef|REPORT_STALE" docs/technicalnew docs/productnew` → 0 命中。
- 剩余的「版本」均为:Git 提交、schemaVersion、配置 RPC、Pi 版本、需求文件 created/updated —— 与模型令牌无关。

## 二、代码(待实施,按阶段)

### 阶段 1:去令牌(语义零变化)

| # | 改动 | 文件 | 验收 |
|---|---|---|---|
| 1.1 | `updateTask` / `endTask` / `prepare_candidate`(整个 op)/ `control` / `adopt` / `requirement.save` / `project.initialize` 去掉 expectedRevision / expectedVersion / expectedPlanVersion | `src/tools/*.ts`, `src/runtime/*` | 同名操作无需版本参数即可成功;冲突由单写者与 inputId 幂等保证 |
| 1.2 | 程序记录「本会话上次读到的内容」;文件被外部修改时返回当前内容并要求重读 | `src/store`, `src/tools/requirement-tools.ts`, `project-tools.ts` | 外部手改需求文件后保存 → 返回当前内容,不覆盖 |
| 1.3 | 删除 `invalidateResultIds`、`supersedesResultId` 及失效声明 | `src/tools/*`, `src/store` | 多份报告按时间保留;完成核对取最近一次通过 |
| 1.4 | `agent_report` 去掉 `kind`、`reportRef`;只接受 body | `src/tools/report-tools.ts` | 派发外的 kind 不能提交;报告正文只能是字符串 |
| 1.5 | `dispatch` 统一三种模式(create/continue/wait),instructions 只在 sessions[] 内 | `src/tools/delegation-tools.ts` | continue 与 create 同形;无 sessions = wait |
| 1.6 | `task` 合并 create/update/end/dispatch/get/control/adopt/recover | `src/tools/task-tools.ts`, `delegation-tools.ts` | 旧名删除,工具集合测试同步 |

### 阶段 2:交付状态由程序绑定

| # | 改动 | 文件 | 验收 |
|---|---|---|---|
| 2.1 | 删除 candidate 对象、candidateId、prepare_candidate | `src/store/store.ts`, `src/tools/task-tools.ts` | 无候选字段 |
| 2.2 | 保存 Review/Test 报告时记录交付状态:有 Git 取提交/工作树,无 Git 取 Task 声明范围文件摘要 | `src/store`, `src/tools/report-tools.ts` | 报告行含 deliverableState |
| 2.3 | `end` 核对:最近一次 passed 复核的交付状态与当前一致;不一致列入缺项 | `src/store/store.ts` | 复核后改动 → COMPLETION_INCOMPLETE 指明重新复核 |
| 2.4 | 删除 REPORT_STALE;相关分支归并 | `src/store`, `src/server` | 错误码表同步 |

### 阶段 3:并行写成员

| # | 改动 | 文件 | 验收 |
|---|---|---|---|
| 3.1 | dispatch 接受 `writeScope: string[]`;同步骤写成员范围重叠时返回 warning(不拒绝) | `src/tools/delegation-tools.ts` | 两个重叠 scope → 警告;不重叠 → 无警告 |
| 3.2 | 任务详情显示每个成员的 writeScope | `src/tools/task-tools.ts`, UI | 可见 |
| 3.3 | 文档中的「同目录一个写者」实现约束移除 | 已改 | — |

### 阶段 4:可发现性(减少试错)

| # | 改动 | 文件 | 验收 |
|---|---|---|---|
| 4.1 | task 的 update/dispatch/get/end 返回 `nextActions`(允许的动作 + 缺什么 + 谁能做) | `src/tools/task-tools.ts` | 每个阶段只列出合法动作 |
| 4.2 | 阶段/角色不匹配、成员未停稳的报错附当前成员状态与可执行选项 | `src/tools/task-tools.ts` | 报错可直接行动 |
| 4.3 | 工具结果的结构化字段继续进入 content(已实现,保持) | `src/tools/tool-kit.ts` | 回归测试 |

## 三、验证计划

1. 单元/集成:现有 262 项测试全部改到新契约;新增:无令牌保存、外部修改检测、报告种类派生、交付变化阻断完成、writeScope 重叠告警。
2. 实机:用现有项目跑一轮 `task(create) → dispatch(develop) → review → test → settle → end`,统计工具错误率;目标:流程类错误 < 5%。
3. 回归对照:同一任务在改造前后的工具调用回合数、错误次数。

## 四、明确不做

- 不自动推进阶段(产品要求主管显式记录)。
- 不自动判定需求完成(程序只报告不一致)。
- 不引入关系表、候选对象或新的状态枚举。
- v1 不支持并行多个 Task 的独立 worktree。

## 五、风险

| 风险 | 处置 |
|---|---|
| 外部手改需求文件被覆盖 | 程序记录上次读到的内容,变化时返回当前内容 |
| 并行写成员改同一共享文件 | writeScope 重叠告警;主管决定 |
| 复核后交付被改动却直接完成 | 程序比较交付状态,列入 end 缺项 |
| 任务状态机的既有测试大量依赖 revision | 阶段 1 一次性迁移,按新契约重写断言 |
