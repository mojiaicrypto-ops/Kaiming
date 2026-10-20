# 当前设计文档验证

本页记录证据，不定义协议。日期：2026-10-04。

## 范围与独立审阅

当前正式文档统一 read/write Task、当前步骤全部成员聚合/超时、Pi 原生历史续办、业务与程序核对边界、通用交互与七角色提示词。上一轮三份独立上下文只读审阅最终 Passed，覆盖归一化的产品与运行契约；发现、修正及历史审查处置见 [审阅记录](../../.agentdev/work/pi-native-normalization-20261004/review.md)。

从正式索引可以开始 P0 SDK 最小试验和纯存储/查询工作，后续按依赖实施。文档完整并不表示所有实现决策或 SDK 行为已经取证；本次具体范围见 [结算记录](../../.agentdev/work/pi-native-normalization-20261004/settlement.md)。历史审查保留其基线结果，不替代当前设计与审阅。

角色经验已写入九份提示词、G4/G5和I4，上一轮两个独立上下文只读审阅 Passed；详见 [角色经验审阅](../../.agentdev/work/role-lessons-20261004/review.md) 与 [结算记录](../../.agentdev/work/role-lessons-20261004/settlement.md)。

本次明确开发内置单元/TDD、独立测试优先 API 集成/UI E2E 的责任，更新 D-05、验收、相关提示词及 G1/G4/I4；一份干净上下文独立只读审阅 Passed，无阻断发现，详见 [测试责任审阅](../../.agentdev/work/testing-responsibilities-20261004/review.md) 与 [结算记录](../../.agentdev/work/testing-responsibilities-20261004/settlement.md)。装配正文提取边界明确，但尚未实现宿主注入或验证实际模型效果。

## 实际文档检查

| 检查 | 结果 | 证据 |
|---|---|---|
| 产品/技术归一化 | Passed（沿用） | 原三份独立审阅；本次G2/G3和消息/存储/运行协议未改，测试责任变化另行审阅 |
| 提示词经验、上下文和角色冷读 | Passed（沿用） | 角色经验两份独立审阅；历史证据不代替本次变更审阅 |
| 测试责任与可执行性 | Passed | 本次独立审阅 D-05、开发/TDD与独立端到端分工、证据、权限、交付状态与阻断及返工 |
| 正文提取契约 | Passed | 按 G4 抽取九份正文（边界改为 `## Base rules` / `## Shared rules` / `## Role and goal`），状态说明/映射表排除；不是实际宿主注入 |
| 提示词与系统级文本语言 | Passed | 九份角色正文与项目入口 AGENTS.md 改为英文；`npm run check:prompts` 按 G4 边界抽取、断言正文无中日韩字符且角色正文齐全，并校验提示词内 36 个链接全部可解析（标题锚点保持原样，人体阅读文档仍为中文） |
| 本地文件/标题链接 | Passed | 正式 28 份 Markdown，逐引用实际检查 |
| 图语法 | Passed（沿用） | 图未变化，保留上一轮 Mermaid 11.12.0 的8图解析证据 |
| 协议示例 | Passed | 本次6个 JSON解析；3段TypeScript未变，保留上一轮严格类型检查证据 |
| 工具、角色与过期字段 | Passed | 8 领域工具 + question 扩展；九份规则/提示文件；旧类型/批次/效果账字段清除 |
| 变更格式 | Passed | 本次文档与工作记录限定范围 git diff --check |

命令、检查计数与实际交付状态分别保存在相应工作记录，不用回复文字代替证据。

## 实施证据边界

实际模型行为（I4）已有真实模型检查；P6 产品验收已按可达范围执行（真实模型 + 真实浏览器），通过项与未执行项逐条登记在结算记录里，其中 AC-03/04/08/09～AC-19/AC-23～AC-26/AC-28～AC-35 仍未执行（多为“设计 → 实施需求 → 开发 Task → Review/Test/结算”完整闭环），四断点视觉与逐组件截图对照也未执行。文档检查不表示功能已实现。

已取得的实现证据：

| 范围 | 证据 | 记录 |
|---|---|---|
| PI-01/02/05/07/08 的 SDK 机制：输入关联、停稳与事件语义、宿主保存失败与停止、多会话隔离、宿主交互往返与 UI 适配器形状 | 47/47 断言真实运行（Node 24.8.0 + Pi 1.0.0，机制层用本地 stub 端点） | `.agentdev/work/devagent-bootstrap-p0-20261004/`、`.agentdev/work/devagent-marker-notice-ui-mode-20261005/` |
| 存储与调度内核（接纳去重、事务认领、一会话一运行中、按代次重启分类、停止意图、轮转调度） | 22 项单元测试真实运行（node:sqlite） | `.agentdev/work/devagent-p1-store-dispatcher-20261005/` |
| **真实模型下的宿主问答往返**（模型实际调用 question 工具、宿主答复回到模型）与上述两条适配器结论 | 4/4 真实模型检查通过（deepseek-flash；模型可达 1.7s、工具调用 1 次 select、答复 B 回到模型、notify/TUI 报错/theme 缺失均符合预期） | `.agentdev/work/devagent-real-model-20261005/` |
| **RPC/认证/只读/写入/SSE/交互桥服务端与浏览器外壳**（同源信封与幂等、会话 cookie+CSRF、SSE 缓冲与 resync、交互 WAL 与答复校验、八视图真实 RPC 渲染、485 选择器保真） | 服务端 209 项单元/集成测试；8 个浏览器场景（真实 Chromium + 真实工作台 + stub 模型端点）；选择器 485/485（extra 0）；提示词 15/15；渲染选型 47/47 | `.agentdev/work/devagent-p4-webui-20261008/` |
| **P6 产品验收（真实模型 + 真实浏览器）**：只读调查 Task（Plan/报告落盘、如实记 not_run）、提案保存（浏览器 confirm 授权）、重启判中断与悬挂提问转 stale、无模型/无效模型的明确说明、备份恢复实跑、八视图无死键无假数据 | AC-01/02/05/06/07/20/21/22/27 有实机证据（部分项标“部分”并写明未执行分支）；AC-08～AC-35 逐条登记未执行 | `.agentdev/work/devagent-p6-acceptance-20261010/` |
| **v1 协议简化（统一 task 工具、去模型令牌、程序观察交付）**：模型可见工具从 10 个收敛为 5 个；版本/候选/报告种类不再由模型传递；复核绑定改为程序观察的交付摘要（路径清单 + 完成时重算）；`nextActions`/拒绝事实可行动 | 274 项单元/集成测试；浏览器 8/8；提示词 15/15；真实模型完整流程 4 次全部完成（每次约 4–6 分钟），最终指标 38 次协议调用/7 次参数错误、步骤拒绝 0 | `.agentdev/work/simplify-v1-20261020/` |
| **P7 模型配置（provider/角色/项目）**：provider 定义写私有文件（0600、密钥不进库与响应）、role→project→server 单一解析实现、保存后无需重启即生效、`config.test` 真实试连、覆盖在实跑中生效（`effectiveConfig` 与 Pi 原生 `message.model` 对照）、活动输入不受设置变更影响（停在 question 上改配置的实跑）、`session.input.get` 返回记录的脱敏生效配置、私有路径守卫（文件工具与 shell，Pi 同序归一化 + 祖先解析，5 种写法端到端全拒） | 228/228（22 文件）+ 浏览器 8/8；三轮独立复核的阻断项全部修复；AC-27 只覆盖本轮可达范围，其余场景未执行 | `.agentdev/work/devagent-p7-model-config-20261010/` |
| **新 UI 层 v1（webapp Chief 视图）+ 服务端活快照**：/app 双壳托管与越界守卫、prepare 快照取活 Pi 会话内存条目（消除 resync 丢在飞消息）、React 壳的 slot 合并（在飞不降级）、高亮预算队列、autoscroll 锁定、Task 卡/成员抽屉（数据路径） | 服务端 235/235（23 文件，含 live-snapshot/stream-harness//app 路由新用例）；webapp vitest 4/4 + tsc 0；playwright 旧壳 8 场景全绿；真实模型 + Chromium 实测：流式不丢、代次变化场景内容延续、刷新后历史完整 | `.agentdev/work/devagent-webapp-chief-20261013` |

仍未取证：PI-01 的压缩/分支关联、PI-07 的配置变化冷恢复、PI-09 并发容量与超时、PI-03/PI-04/PI-06、P6 完整产品验收（浏览器全链路与视觉对照）与其余产品验收场景、P7 的"恢复已执行输入按原配置"（本实现不重放旧输入，无落点）、命令执行的沙箱隔离（P-05 已按事实明示边界）。其余实施证据边界见相应结算记录。
