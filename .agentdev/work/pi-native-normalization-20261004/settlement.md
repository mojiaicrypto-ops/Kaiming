# 文档归一化结算

日期：2026-10-04。范围：当前产品需求、技术契约、全部角色提示词与导航；未实现业务代码，未检查旧工程功能。

已落地：Task 仅 read/write；read 产物 Server；主管总体 Plan 与显式步骤；当前步骤全部子 Session 聚合/timeout；普通 Pi 交互直回源请求；原生历史与已知成果核实后续办；业务判断交 Agent，程序核对身份/状态/必要报告/版本/保存；保留独立 Review → 适用 Test → 结算。

正式依据：[技术入口](../../../docs/technicalnew/README.md)、[工具契约](../../../docs/technicalnew/agents-and-tools.md)、[协作](../../../docs/technicalnew/messaging-and-collaboration.md)、[恢复](../../../docs/technicalnew/storage-and-recovery.md)、[产品交付](../../../docs/productnew/modules/delivery.md)。字段/流程唯一在对应链路定义，提示词引用这些契约而不另设 Schema。

独立审阅：[review.md](review.md)，三个干净上下文最终 Passed。原生工具级 sequential、恢复准入、报告结构及需求纠错/取消边界的小问题已修复并复核。

实际检查：见 [verification.json](verification.json)。覆盖正式 28 份文档、本地文件/标题链接、8 张 Mermaid、6 个 JSON、3 段 TypeScript、9 个模型工具入口/角色和过期字段检查及限定范围 diff --check。SDK、真实模型、故障与浏览器运行全部 NOT_RUN；不声称项目功能已完成。

上下文及冻结版本：[context-snapshot.json](context-snapshot.json)。业务代码、旧文档移动/删除及其他既有改动不在本次提交；源码/测试地图未受实现变化影响，无需编造未来入口。

保存：本次仅提交上述正式文档与本目录工作记录；提交结果由 Git 记录及最终回复给出，不回填提交号制造第二次提交。

下一步：按 I1 先验证固定 Pi SDK 关联/保存/取消/原生 UI 与等待；通过后按 I2 推进存储、共用 Runtime、协作与 UI。若真实 SDK 行为与设计不符，先用试验证据修正最小技术契约，再继续，不创建替代执行引擎。
