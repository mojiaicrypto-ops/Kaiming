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
