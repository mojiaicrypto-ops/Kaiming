# P2-6 结算

- **提示词**：`base.md` v6 固定知识目录并写明 add/edit 差异；`chief.md` v8 写明设计门禁只读 `.dev/product/`、`.dev/technical/`（初始化入口文件由结算保存、不进入门禁）与切片写入通道。
- **工具描述**：`backlog` 分开 add/close 与 edit；`project` 写明知识布局与门禁路径。
- **派发信封**：design+designer 追加目录/门禁/add-edit 说明，其余组合不追加。
- **契约记录**：`docs/technicalnew/agents-and-tools.md` G2 edit 行与 G4 已更新；`docs/technicalnew/validation.md` 增加 P2-6 条目。
- **未改**：完成门禁本身、`editRaw` 语义、backlog op 集合、任何项目已有目录。
- **生效**：提示词按进程缓存，workbench 重启后 v6/v8 才进入模型系统提示。
- **遗留**：变更前的项目（如 aijuese）已有切片若缺 `- 规格:`/`- Task:` 仍需人工或后续 Task 修正；本变更只保证新设计不再因目录名与 edit 语义被误导。
- **证据**：Review 两轮（needs_fix → pass）；独立 Test passed，含三条已知坏输入（删 base 段、移到 chief.md、去掉 workKind 守卫）与检查器自检；focused 套件 32/32、相关回归 36/36、`check:prompts` 15/15。
