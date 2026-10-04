# Chief v2 提示词文档结算

日期：2026-10-04。用户确认提示词草案并明确要求优化写入文档。本次只修改 Chief 提示词与导航状态，未修改业务代码、工具 Schema、基础或专业角色提示词。

## 结果

- Chief v2 明确角色目标、六个核心概念、意图判断、Task 创建与当前步骤委派。
- 分析、设计、标准实现分别提供流程骨架与工具调用责任；专业 Session 全部绑定 Task，分析工作不强制进入代码交付。
- 需求读取/list/get、总体 Plan/createTask、显式 updateTask、当前分工/createTaskSessions、成果固定/prepare_candidate、真实交互、停止恢复、结算/endTask 与需求状态保存有明确条件。
- 保留项目授权、逐 Plan 确认、中间交互原批次等待、停稳后修改指令、未知效果核实、独立 Review/Test 和覆盖缺口处置。
- 同目标补设计与不同目标替代保持产品规则；轻量修改保留无需强制建立需求的适用路径。

## 独立审阅与检查

独立只读 reviewer：/root/chief_prompt_review。读取当前 Chief、产品 requirements/delivery/project-knowledge、G2/G3/base 与旧提示词差异，不读作者聊天，不改文件。

文档审阅结论：ReviewPassed，未发现工具名称、执行时序或内部矛盾阻断。两项非阻断建议已采纳：设计接纳后读取/维护关联提案规划中状态（无提案不补造），非阻断覆盖缺口须真实用户处置。

实际检查：
- `node /tmp/agentdev-doc-check.C8cqSd/current-docs.mjs`：通过，当前 21 份 Markdown、110 本地链接/锚点，无错误。
- 提示词概念/工具责任/流程完整性检查：通过，六概念、三流程示例、核心与辅助调用、启用限制均存在。
- `git diff --check -- docs/technicalnew/prompts/chief.md docs/technicalnew/README.md docs/INDEX.md .agentdev/work/chief-prompt-20261004`：通过。
- 模型、SDK、浏览器、故障与运行验收：NOT_RUN，不能从文档审阅推断运行行为已通过。

## 待同步边界与保存

Chief v2 是目标提示词，不直接启用。分析 Task 的接纳/完成、全部专业委派绑定 Task、统一设计角色、提案/实施需求 Schema、完成收口以及基础/专业提示词与行为检查仍须同步。docs/INDEX.md 和 technicalnew/README.md 已标明；现有技术验证不覆盖这些变化。

产品结构与本轮业务代码无变更，不更新代码地图。不修改 AGENTS、项目规则或 skill。最终文件与记录独立提交；用户原有源码、旧文档迁移与其他未跟踪文件保持原状。
