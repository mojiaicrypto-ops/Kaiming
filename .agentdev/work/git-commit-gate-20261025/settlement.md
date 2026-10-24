# Settlement · git-commit-gate-20261025

状态：Completed（独立 Review 与独立 Test 均通过；文档已同步；本任务成果已提交）。
Plan：[plan.md](plan.md) · 实现：[implementation.md](implementation.md) · Review：[review.md](review.md) · Test：[test.md](test.md)。

## 交付内容

| 类别 | 内容 |
|---|---|
| 产品行为 | 有 Git 的项目里，被独立复核覆盖的交付路径未提交（含被 `.gitignore` 排除、位于内嵌仓库而外层未记录）时，`task end` 拒绝收口并列出文件与动作；提交由主管或结算角色完成（D-07） |
| 代码 | `devagent/src/runtime/git-delivery.ts`（新，宿主观察）、`devagent/src/tools/completion-git.ts`（新，取复核路径与 cwd 组合）、`endOp` 前置门禁、`guidance.completionFacts` 同步 |
| 测试 | `devagent/test/git-commit-gate.test.ts`（23 例）：观察器矩阵、store 级 gate、真实 `task` 工具端到端、真实 submodule 生命周期、两层内嵌、忽略的仓库根、`.git` 假标记、205 路径分批 |
| 文档 | D-07；`agents-and-tools.md` 完成条件（三类事实）；`storage-and-recovery.md` 收口顺序；`implementation-checks.md` REL-17；`prompts/chief.md`、`prompts/settler.md`；`ui-design.md` U1 设计基准行；`validation.md` 本轮记录 |

## 验证（实际执行）

- `devagent`: `npx vitest run` → 33 files / **368 passed**；`npx tsc --noEmit` → 0 diagnostics。
- `devagent/webapp`: `npx vitest run` → 31 passed。
- `devagent`: `npm run test:browser` → 40 passed。
- 独立 Test 自建 39 个探针场景（生产模块直调，不复用新测试文件），结论：**没有一种「复核过的交付未提交」的形态能收口**；已提交的合法形态（submodule、嵌入式仓库、忽略的仓库根、两层嵌套、项目位于更大仓库下）在各自仓库记录后可收口。
- 独立 Review 四轮，最终结论 **passed**；期间发现并修复：gitignore 排除的交付静默放行、内嵌仓库静默放行、submodule 路径致 `unverifiable`、`.git` 假标记误判、两层嵌套按最深边界分组、submodule 脏内容被误报为「指针未记录」。

## 未覆盖 / 已知限制

- 程序不代提交（第二步的范围）：模型仍可能在缺项上反复，但失败可见、Task 不假完成。
- 回执里的 commit hash 与 HEAD 未做比对（模型自述，不进门禁）。
- 同一文件内用户的手改会与交付一起提交（沿用文件级摘要口径）。
- 删除或改名被复核覆盖的文件，提交后仍会被摘要门禁要求重新复核（既有策略，非本门禁缺陷）。
- 未执行：模型在环的提示词遵从、结算回执链路、Windows、超大规模仓库的单次 git 延迟测量。

## 保存

代码、测试、文档与本记录随本次提交进入版本库；提交后 `task end` 对该 Task 的门禁与本次实现一致（复核覆盖路径相对 HEAD 干净）。
