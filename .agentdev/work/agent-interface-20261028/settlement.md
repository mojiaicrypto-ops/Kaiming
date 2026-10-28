# Settlement · 外部 Agent 接入（MCP）产品文档

```yaml
settlement:
  task: agent-interface-20261028
  scope: 产品设计文档（product-design lane）；实现未开始
  date: 2026-10-28
```

## 1 稳定事实（本次新增或改写）

| 事实 | 依据 |
|---|---|
| 目标调用方是 MCP 客户端，不是 ACP 客户端：本机实测 Codex 0.155.1 协商 `2025-06-18`、Claude Code 2.1.310 先探测 `server/discover`(2026-07-28) 再协商 `2025-11-25`，两者都声明 `elicitation:{form,url}`，`tools/call` 带 `progressToken`，75 秒调用不中断 | plan 附录 A（原始帧与命令） |
| 无人值守时 elicitation 不可依赖：Codex 回 `decline`、Claude Code 回 `cancel` | 同上 |
| 产品新增第六个模块「外部 Agent 接入（MCP）」，需求 `X-01`～`X-08` | `docs/productnew/modules/external-agents.md` |
| 外部接入使用**每项目一条固定会话**，是对 C-02/D-01/A5「其他话题开新主管 Session」的显式例外；未结束则排队 | 模块 `X-02`（含例外声明） |
| 调用方 = 一个用户：不新增策略层、不强制只读；`authorizationRef` 就是委派输入 | 模块 `X-03`；plan §8 |
| 对外状态集合：进行中、排队中、等待用户答复、已暂停、执行情况未知、已完成、已失败、已取消 | 模块 `X-04`；plan §3 |
| 提问主通道是查询结果 + 显式答复；elicitation 只是加速器 | 模块 `X-05` |
| 只读列表能力：已登记项目、项目需求；另有「该项目最近的工作」用于断线接续 | 模块 `X-06`；plan §3（`agentdev_runs`） |

## 2 更新的权威文档

| 文档 | 改动 |
|---|---|
| `docs/productnew/modules/external-agents.md` | 新增：目标与边界、X-01～X-08、失败与边界表、本模块验收 |
| `docs/productnew/README.md` | §2 使用场景加一条；§3 模块表加一行、能力承载句改为「其余四项能力；浏览器与外部 Agent 是两个入口」；§6 可见能力加「外部接入可见」；§7 首版范围加一行；§8 完成判据纳入 J-11 |
| `docs/productnew/journeys.md` | 新增 `J-11 用别的编码 Agent 委派一项工作` |
| `docs/productnew/acceptance.md` | 新增 `AC-38`～`AC-42`；整体交付检查改为 `J-01～J-11` |
| `docs/INDEX.md` | 产品需求行改为「六个业务模块（含外部 Agent 接入）」 |
| `.agentdev/work/agent-interface-20261028/plan.md` | 状态/需求 ID/产品依据；§2.1 固定会话；§8 已定取舍；§10 文档改动 |
| `.agentdev/work/agent-interface-20261028/review.md` | 独立评审三轮记录与结论 |

## 3 未改动（检查过，确认不受影响）

- `docs/technicalnew/*`：MCP 技术契约（`mcp-service.md`）、R1 的 `session.open`、A3 的 `sessions.channel`、v14→v15 迁移均属 P1，随实现写入；`gap-register.md` 的登记同样在 P1。
- `docs/technicalnew/validation.md`、`gap-register.md` 中以 `J-01～J-10` 描述已执行/未执行范围的表述属历史证据口径，随 P1 一并更新（评审观察 O1）。
- `devagent/**` 代码、`webapp/**`：本次为文档任务，未触碰。

## 4 执行过的检查（真实命令与结果）

| 检查 | 命令 | 结果 |
|---|---|---|
| 文档链接完整性 | 逐文件解析 `](*.md)` 相对路径并 `os.path.exists` | 无缺失链接 |
| 需求 ID 与标题一致 | 扫描各模块 `## [A-Z]-\d+` 标题，与全文引用求差 | 56 个需求标题（含 X-01～X-08），引用无孤儿 |
| 验收编号 | `AC-(\d+)` 全集 | 1..42 连续，无缺口 |
| 流程编号 | `## J-\d+` | J-01～J-11 连续 |
| 独立评审 | 三轮只读评审（评审上下文不含开发聊天） | 最终 `passed`，无 blocking |

未执行（明确）：任何运行时/浏览器测试——本次没有代码变更，产品验收场景（AC-38～AC-42）需在 P1 实现后执行，此处不记为通过。

## 5 需要用户确认的事项（已确认）

- 传输：stdio + 常驻 `/mcp`（已确认）。
- 会话：每项目一条固定会话、复用、排队（已确认；A5 例外已在文档声明）。
- 策略：不加策略层，调用方就是用户（已确认）。
- 列表：开放项目列表与需求列表（已确认）。
- 本次新增的产品行为与验收编号（本文档集）已随"需要新增产品文档，按照流程走"确认。

## 6 完成判据

- [x] Plan 存在且已确认取舍（`plan.md` status: Approved）
- [x] 产品文档写入并按既有模块格式；导航与索引同步
- [x] 独立评审 `passed`（三轮，blocking 已关闭）
- [x] 受影响的验收与完成判据已更新（AC-38～AC-42、J-11、README §8）
- [ ] 实现与运行时验证：未开始（P1）
- [x] 任务证据归档（plan / review / settlement 在本目录）
- [x] git 提交（见提交记录）

## 7 遗留与后续（P1 输入）

1. schema v14→v15：`sessions.channel` + 部分唯一索引；`session.open`；`session.list` 回 `channel`。
2. MCP 服务：stdio 与 `/mcp`，工具 `delegate/status/wait/tell/answer/cancel/read/runs/projects/requirements`。
3. `docs/technicalnew/mcp-service.md` + R1/A3/存储迁移的契约补写 + `gap-register` 登记（MCP 未实现、channel 未实现、只读委派无硬保证）。
4. 真实客户端门禁：Codex 与 Claude Code 各跑一次（stdio 与 http），日志存入验证记录。
5. 未实测：Grok（未安装）；Windows/远程部署下的 `/mcp` 行为。
