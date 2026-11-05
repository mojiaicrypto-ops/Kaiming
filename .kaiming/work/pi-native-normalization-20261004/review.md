# 文档归一化独立审阅

日期：2026-10-04。结论：Passed；本次冻结正式契约未发现残留 P1/P2 实施阻碍。该结论仅针对文档，不证明运行能力。

三个独立上下文、只读 Agent：

| 审阅 | 上下文 | 最终结果 |
|---|---|---|
| normalized_product_prompt_review | 产品全部模块/流程/验收、G1～G5、九份提示词 | Passed；两类 Task、适用责任、控制与模型规则一致 |
| normalized_runtime_review | 架构、运行、存储、协作、工具与实施检查；固定 Pi 类型 | Passed；状态/字段、当前成员等待、恢复及原生工具配置可实现 |
| normalized_cold_developer_review | 从 AGENTS/索引按链路读取产品与技术，模拟首次实施 | Passed；可按正式入口开始 P0/纯存储，并依接入证据继续后续工作 |

未向审阅者传递开发聊天；未用旧代码、docs/old 或历史审阅的 Passed 补充当前契约。写入仅由根 Agent 完成。审阅期间的小修正均经最终重读，不使用过期快照判定当前结果。

## 审阅修正

- 提示词的规范入口映射补全 M/S/T；需求启动顺序为先总体 Plan 与 createTask 保存，已有工作核对后接续。
- read Task Plan/报告存 Server，write 存项目；requiresTest 在 read 缺省 false，在 write 必填，不由程序猜业务责任。
- 当前步骤成员保留于 currentSessionIds；全员结束后聚合，timeout 只快照。updateTask 带 phase 开始新步骤，不带 phase 只更新摘要。
- chief 自身 interrupted 先直接 inspect/resolve 核实关闭，再接受原 Task 新续办输入；子 unknown 保留。现有 task.reconcile 接收明确原输入/证据/结论，调用同一服务。
- 暂停或关联输入中断时 investigator + expectedKind=recovery 在 create/claim 均有只读例外，报告 Server，不解除控制、不清除原成员、不并发 prompt。
- Review/Test verdict 必填；程序认可 passed、同候选、未失效/替代且来源停稳。内容判断与覆盖处置仍归 Agent。
- Pi executionMode 按整个工具静态注册，不能按同一 task 工具的 op 动态切换；无需额外调度层。
- 损坏需求 id/kind 通过原 save/CAS 修复，合法类型不转换，原类型无法核实时需明确纠错决定。
- 实现 Task 取消与实施需求取消分开；提案设计取消的既有规则保留。取消需求先停关联工作，程序不自动同步业务状态。

## 既有审查处置

历史记录保留当时事实；下表是当前设计的处置，不把旧行号/旧摘要当现行契约。

| 历史发现 | 当前处置 |
|---|---|
| DA-01 只读调查要求项目写入 | read Plan/报告在 Server，项目零写入路径明确 |
| DA-02 部分阻断无法等剩余成员 | 当前步骤全员聚合；timeout 不取消；currentInputId 指向续办输入 |
| DA-03 自然语言批准范围机械匹配 | 通用问答事实由宿主保存，业务含义模型判断 |
| DA-04 basisDigest 投影未定义 | 删除通用语义摘要；文件版本用于 CAS/保存，实质改变由 Agent 判断并显式失效报告 |
| DA-05 暂停/中断不能安排核实 | 明确恢复 investigator 的双重准入及 chief 自身恢复入口 |
| DA-06 UI 调用契约缺失 | R1 补配置、受控文件/报告阅读、认证与清理方法 |
| DA-07 损坏元数据无法修复 | F4 明确合法记录不变、损坏字段纠错的身份来源/决定/CAS |
| DA-08 Task/需求取消混同 | R-05/AC-19 区分实施执行与需求目标，主管显式组织停止与保存 |

当前不需要增加 Run/Attempt、批次业务对象、业务确认类型、逐原生工具效果账、ToolResult 修补或恢复工具执行栈。

## 实施边界

可开始 P0 固定 SDK 试验和 P1 纯存储/查询/需求保存。Runtime、协作、UI、恢复按 I1/I2 的依赖取得真实证据。SDK、模型、崩溃、取消与浏览器验收全部 NOT_RUN；文档审阅通过不取代它们。
