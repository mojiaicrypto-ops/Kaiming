# P2-4 实施记录

## 改动

- `webapp/src/project/project-model.ts`：新增 `activeWork(item)`（未结束领取 Task，否则仍在进行且产出该切片的 design Task）；`flowChain` 用它推导工作类型与阶段，`awaitingDesign` 保持原语义（领取或产出的设计 Task 未结束）。分列仍只看领取关系，未改变看板语义。
- `webapp/src/project/ProjectPage.tsx`：卡片改为编号 + 两行标题 + 阶段链 + 一行元信息（工作类型、切片数、待设计确认/等你决定、返工、问题数），删除卡片内重复的切片编号清单；直接工作区移到流程带之后、看板之前。
- `webapp/src/theme/base.css`：内容区 1080→1320，四列间距/卡片内距放宽；流程带由六个描边块改为带细分隔线的摘要行；阶段链由胶囊改为“完成/当前/计划”三态文本链；新增 `.pp-card-meta`/`.pp-flag`；空列与新增输入行贴合栅格。
- `webapp/test/project-model.test.ts`：新增“待设计确认切片显示产出设计链（settle 当前、确认门已完成），领取优先于产出”的用例。

## 验证

- `npx vitest run --root webapp test/project-model.test.ts`：13/13。
- `npm --prefix webapp test`：20 文件 138 用例。
- `npm run test:browser -- --grep "project"`：16/16（含设计切片不可实施、模块链接、问题定位）。
- 真实 CharKeep 项目（运行中的 workbench）：11 条切片在“就绪”，卡片显示 `Design→Review→you confirm→Settle` 与“待设计确认”，直接工作行显示 `t-2dbe518eeb45 · Design · Review · Running`；卡片抽屉仍显示切片编号清单。截图对比：改版前 4 个胶囊阶段 + 4 个标签 + 编号清单；改版后 3 行。

## 追加：拆分去向只属于被领取的原条目

- 运行中的 CharKeep 每个切片卡片都显示“10 slice(s)”/抽屉“split into B-10…B-1”，因为 `backlogItemView` 把同一 design Task 的**所有产出切片**都算成当前条目的拆分去向。BL-04/BL-08 只让原条目写拆分去向；切片应通过“产生它的 Task”回到设计。
- `kaiming/src/server/read-methods.ts`：`splitInto` 只遍历 `claimed` 的 design Task（领取本条目者）。B-1（被领取）仍列出 B-7/B-8；B-7 自己为空，`producerTasks` 指向 `t-d`。
- 测试：`test/backlog-rpc.test.ts` 新增真实文件 + 设计 Task 用例；把循环改回 `related` 时该用例按预期变红（`expected [ 'B-1', 'B-8' ] to deeply equal []`），恢复后 8/8 通过，`tsc --noEmit` 通过。
- 运行中的 workbench 仍是旧进程；该服务端改动需重启才在 127.0.0.1:4173 生效（未改动用户进程）。

## 追加：待确认切片的分列（复核后按契约收敛）

- BL-04 的就绪要求规格引用；设计还在写规格期间，产出切片会暂时落在想法。曾试过让 `awaitingDesign` 也进就绪，复核指出这与 BL-04/U6 冲突，已撤回：这类切片留在想法，但卡片标“待设计确认”并按产出设计 Task 的真实阶段显示设计链。
- 测试：`webapp/test/project-model.test.ts` 的 B-9 用例锁定“想法 + awaitingDesign + 设计链（design,review,gate,settle）”；把判定去掉时该用例变红。

## 复核修正（2026-11-18）

- **未定义令牌**：新样式误用 `--muted/--border/--warning`，`tokens.css` 里实际是 `--fg-3/--line/--run`；已全部替换。顺带把该区块沿用的 `--border`（一直未定义，列/卡边框实际为 0）改为 `--line`，并按 U3「直角」把列/卡圆角改为 0。
- **结算后的产出 Task**：`activeWork` 的 `OPEN_TASK` 过滤此前无用例；新增“completed design producer → 无 activeWork、实施链”用例，去掉过滤时该用例变红（`expected { taskId: 't-d', … } to be undefined`）。
- **切片数语义**：设计 Task 未领取任何条目时不再显示“10 slice(s)”——这些切片不是拆分来源；卡片“切片数”只用于被领取并拆分的原条目（本次 CharKeep 因此没有该标签）。
- 复核发现的历史证据数字已更正为 project-model 15/15、webapp 140/140。

## 独立复核后的收口

- **对比度**：去掉 `.pp-chip.planned` 的 `opacity: 0.55`（深色 2.46:1、浅色 2.11:1，低于 U7 的 4.5:1），改为 `color: var(--fg-3)`，实测 5.22:1 / 4.62:1。
- **分列回归契约**：撤销“产出但未写规格引用的切片进就绪”的改动。BL-04/U6 的就绪仍要求规格引用；这类切片留在想法，但保留“待设计确认”与设计链（用例锁定：想法 + awaitingDesign + 设计链）。文档补一句说明该过渡态。
- **等你决定**：卡片的 pending 取 `activeWork(item)`，未领取的产出设计 Task 上的提问也会标出。
- **文档**：U6 的顺序改为“流程带 → 新增待办输入 → 直接工作 → 看板”，阶段链改为“带箭头文字链、当前加粗、未来减淡”。
- 复核后：project-model 15/15、webapp 140/140、backlog-rpc 8/8、project 浏览器 16/16（重跑）。
