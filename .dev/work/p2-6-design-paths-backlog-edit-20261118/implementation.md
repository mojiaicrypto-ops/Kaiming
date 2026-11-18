# P2-6 实施记录

## 提示词

- `docs/technicalnew/prompts/base.md` v6：新增固定知识目录一段（AGENTS.md/.dev/PROJECT.md、.dev/INDEX.md、.dev/product/、.dev/technical/、.dev/backlog.md、.dev/work/<taskId>/），并规定“已有权威目录继续维护，否则写这些路径，不要自造目录名”；第 15 段补 `add`/`close` 与 `edit` 的区别（edit 不刷新更新时间、不绑定 Task；新切片用 add，细化既有条目要写规格引用与 Task）。
- `docs/technicalnew/prompts/chief.md` v8：切片段写明设计完成门禁只读 `.dev/product/` 与 `.dev/technical/` 及入口文件，并写明 add/edit 的切片写入差别。

## 工具描述与信封

- `kaiming/src/tools/backlog-tools.ts`：把“Writes allocate ids…”改成 `add`/`close` 与 `edit` 分开说明；点明 `- 更新:` 不刷新、`- Task:` 不绑定。
- `kaiming/src/tools/project-tools.ts`：描述加入知识目录布局与设计门禁读取路径。
- `kaiming/src/tools/delegation-tools.ts`：`buildDispatchEnvelope` 仅在 `workKind=design` 且 `roleId=designer` 时追加 “Design delivery: …” 一行（目录、门禁、add/edit 语义）。

## 文档与验证

- `docs/technicalnew/agents-and-tools.md`：G2 edit 行写明纯文本替换；G4 写明 base 携带目录、chief 携带门禁、design+designer 信封追加同一条事实。
- 测试：`test/delegation.test.ts` 新增 design designer 信封正例 + developer/reviewer 负向对照；`test/context.test.ts` 新增 chief 装配文本包含目录与门禁且不含 designer 专属句（负向）。
- 实测：`vitest run test/delegation.test.ts test/context.test.ts` 32/32；`test/backlog-tools.test.ts test/task-tools.test.ts test/project.test.ts` 42/42；`tsc --noEmit` 通过；`npm run check:prompts` 15/15。
- 生效条件：提示词按 `promptDir` 每进程缓存（`runner.bodiesFor`），需重启 workbench 后新正文才注入。

## Review 修正

- 门禁句不再声称读取入口文件：`.dev/PROJECT.md` 等在初始化后由结算保存，`design-completion.ts:24` 把它们作为排除项传入快照；chief 正文、project 工具描述、agents-and-tools G4 均改为只读 `.dev/product/`、`.dev/technical/`。
- chief 自身的 `add` 不绑定当前 Task（`backlog-tools.ts` 只对 designer/settler 写 taskIds），chief 正文改为“designer/settler 的 add 绑定本 Task，chief 自己的 add 需用 edit 补 `- Task:`”。
- 测试补两条对照：developer 装配正文也包含目录（防止把目录段挪进 chief.md）；designer+document 的信封不含 Design delivery（防止丢掉 workKind 条件）。
