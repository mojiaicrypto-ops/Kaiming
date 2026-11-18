# Independent Test — P2-6

Date: 2026-11-18. Independent agent context; workspace untouched; live workbench (PID 49666, :4173) not restarted. All runs in a full /tmp copy.

## Verdict: passed

| 验收 | 结果 | 证据 |
|---|---|---|
| A. base 携带固定知识目录，chief 装配含目录与设计门禁 | pass | 真实 `loadPromptBodies`/`assembleSystemPrompt`；chief=[base,chief]，developer=[base,specialists,developer]；`snapshotDesignDelivery(cwd, knowledge)` 只含 `.dev/product/flow.md`、`.dev/technical/api.md`，排除 `.dev/specs`、`.dev/tech`、`.dev/work`、`.dev/backlog.md` |
| B. 信封只在 design+designer 追加 | pass | design+designer 含三条；design+reviewer、implement+developer、document+designer 均不含 |
| C. 工具描述准确 | pass | backlog 描述分开 add/close 与 edit（含 `- 更新:` 不刷新）；旧 “Writes allocate ids…” 只剩历史验证记录；project 描述只写 product/technical |
| D. 存储行为未变 | pass | `editRaw` 仍原文字面替换（更新时间和 taskIds 不变）；OPS 无新 op；chief 的 add 不写 `- Task:` |

## 伪证（都在 /tmp 副本上，按预期红）

1. 删除 base 布局段：布局断言失败（probe 2 failed，仓库 `context.test.ts` 1/7 失败）。
2. 把该段只移到 chief.md：developer 装配断言失败（probe 1 failed），chief 侧仍绿。
3. 去掉信封守卫的 `workKind === 'design'`：document+designer 负向对照失败（probe 1 failed；仓库 `delegation.test.ts` 1/25 失败）。
4. 检查器自检：`chief.text === base.text + "\n\n" + chief.text`；注入 sentinel 后能被检出，真实装配不含 sentinel。

## 计数

- `delegation + context` 32/32；`backlog-tools + task-tools` 36/36；独立 probe 13/13；`check:prompts` 15/15。

## 生效条件

`SafeRunner.bodiesFor` 每进程缓存提示词：运行中的 workbench 仍是 base v5 / chief v7，重启后才注入 v6/v8。
