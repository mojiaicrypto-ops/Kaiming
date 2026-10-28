# Review · 外部 Agent 接入（MCP）产品文档

独立评审，评审会话与开发会话分离，评审上下文只含文档、基线与已确认取舍，不含开发聊天记录。

```yaml
review:
  task: agent-interface-20261028
  reviewer_session: 只读评审会话（external-agents doc review，未编辑任何文件）
  reviewer_model: 与开发对话不同的会话上下文（独立 agent）
  context_snapshot: >
    docs/productnew/modules/external-agents.md（新增）、README / journeys / acceptance / INDEX 的改动、
    chief-conversation（C-02/C-05/C-06）、delivery（D-02/D-04/D-06/D-09）、requirements、
    technicalnew/architecture（A3/A5）、runtime-contract（R1/R2）、
    .agentdev/work/agent-interface-20261028/plan.md（§2/§2.1/§3/§5/§8）
  rounds: 3
  result: passed
```

## 轮次与结论

| 轮 | 输入 | 发现 | 结论 |
|---|---|---|---|
| 1 | 新增模块 + 四处导航/验收更新 | 2 blocking（固定会话未声明是对 C-02/D-01/A5 的例外；X-03 与 X-05 对"用户决定"的答复路径自相矛盾）+ 5 non-blocking + 6 遗留项 | failed |
| 2 | F1–F7 修复 | 两个 blocking 均已关闭；新增 N1–N4（non-blocking） | passed |
| 3 | F8–F13、N1–N4 修复 | 全部关闭；新增 N5–N7（non-blocking） | passed |
| 收尾 | N5–N7 修复 + 措辞对齐 | N8 关闭；无客户端无法构造的验收步骤 | passed |

## blocking 发现与处理

| 发现 | 处理 |
|---|---|
| 固定会话把"另一个话题"排进同一会话，与 C-02「其他话题使用新主管 Session」、D-01、A5 冲突，且未声明为例外 | `external-agents.md:30` 明确声明为**一处有意例外**并给出理由（调用方无法选择会话；按话题新建会切断连续性），规则为"排队而不是新开会话" |
| X-03 说目标/范围/验收的变更"只能由用户在浏览器决定"，与 X-05「所有提问可由调用方显式答复」冲突；两种修法都会引入模块明确拒绝的东西（策略层或浏览器专属通道） | `:44` 改为：仍由用户决定，这类问题按 X-05 出现在查询结果里、可由调用方显式答复；调用方不能在未被提问时自行变更 |

## non-blocking 发现（全部关闭）

状态集合补"已暂停/执行情况未知"并与 plan 枚举对齐；重启后 `interrupted` 对该项目后续委派的影响写明；删除固定会话限定在既有清理规则内并区分两种拒绝；"工作台未启动"改为可达的启动/附着失败；补"查看最近工作"与"返回 run 标识前断线"的接续路径；验收步骤改为可构造（J-11 纳入完成判据、无人值守替代"不支持的客户端"、只读列表用前后对比、跨项目委派补步骤、模块验收表与 AC-41 对齐、C-01 直接回答构造可清理会话）；术语与依据链修正（AC-39 补 X-04）。

## 评审明确保留的分工

- **失败与边界**写产品规则（含"客户端不支持就地交互（未声明 elicitation）"这类能力差异），**本模块验收**只写今天能用现有客户端做出来的观察。两页共享同一句行为结论（问题留在查询结果里等显式答复），不构成两套规则。

## 未覆盖

- 实现层面的评审（schema v15、`session.open`、MCP 工具实现）尚未开始，属 P1，需独立评审与真实客户端测试。
- 真机验证只用到了 Codex 0.155.1 与 Claude Code 2.1.310；Grok 未安装，其协议版本与 elicitation 支持来自官方文档而非实测。


## 代码评审（2026-10-28，MCP 实现；独立会话，只读）

评审对象：`devagent/src/mcp/**`、`src/runtime/task-progress.ts`、store v15、read-methods 增补、`/mcp` 挂载与测试；对照 `docs/technicalnew/mcp-service.md` 与 X-01～X-08。

| 轮 | 发现 | 结论 |
|---|---|---|
| 1 | 4 blocking：① 重启带未完成工作时 `startWorkbench` 把恢复诊断写到 stdout，破坏 stdio 协议流；② 第二个 MCP 进程会在同一库上再开 workbench（epoch 变化把前一客户端的在跑工作标成 interrupted）；③ 排队中的 run 说不出在等谁（`waitingForTask` 恒为 null，缺模型时也说"等会话空闲"）；④ `cancel` 对 `paused` 的 Task 不下发控制，项目被永久堵住。另有 6 项非阻塞（报告 verdict 未参与"是否通过"、`/mcp` 会话按创建时间而非空闲过期、无 token 也发 progress、transcript 回退会返回他人回合、死字段、缺测试） | failed |
| 2 | 10 项全部修复并由评审逐项复核关闭；新增 3 项非阻塞：① 浏览器成员行仍把"输入结束"当通过（与外部面不一致）；② 契约页 M1/M9 与 `project_path` 描述过时；③ 一条永远为真的测试断言 | passed |
| 3 | 前两项关闭（共享 `memberPassed` 规则下沉到 `task-progress.ts`，浏览器 `flowOf`/成员行同谓词；契约与描述更新），新增 2 项 P3 措辞/覆盖细节 | passed |
| 收尾 | 成员行注释、失败输入无报告的用例补齐 | passed（无新发现） |

已关闭的 blocking 与证据：

1. `startWorkbench` 增加 `log` 汇（默认 stderr），四处恢复诊断改走它；`test/mcp-instance.test.ts` 用带外来 epoch `processing` 输入的数据目录启动真进程，断言 `initialize` 应答且 stdout 无任何非 JSON 行。
2. `mcp-instance.json`（pid+origin）+ 附着顺序（显式 URL → 记录中的活实例 → 占用配置端口的 workbench → 自己启动并绑定配置端口）；同测试起第二个客户端，断言同一 store 可读同一 run、非属主的退出不删记录、属主退出后记录消失。
3. `awaiting` 扩为 `queued|blocked|user|none`，`waitingForTask` 取会话 `currentTaskId`，`summary` 带 `session.blocked` 的真实原因；`test/mcp-runs.test.ts` 两个用例钉住。
4. `cancel` 对所有非终态 Task 下发 `task.control{cancel}`（带 revision CAS）；单测断言调用与 CAS，端到端断言收紧为 `cancelled`。
5. 通过与否的规则下沉为共享 `memberPassed`（输入结束且最新报告不是 `failed`/`blocked`），fixture 增加"复核完成但报告未通过"用例，浏览器成员行另有单测。
