# Implementation · git-commit-gate-20261025

状态：Developing → Reviewing（实现完成，等待独立 Review）。
Plan：[plan.md](plan.md)。范围为 G1–G4（观察器、组合判定、end 门禁与 guidance、契约同步）。

## 实际改动

| 位置 | 改动 |
|---|---|
| `devagent/src/runtime/git-delivery.ts`（新） | 宿主观察：`rev-parse --is-inside-work-tree` 判仓库、`rev-parse HEAD`、`status --porcelain=v1 -z --untracked-files=all -- <paths>` 取 dirty。非仓库 → `no-git`（不产生缺项）；仓库存在但 status 失败 → `unverifiable`（阻断）。status 输出是仓库相对路径，用 `rev-parse --show-prefix` 换回项目相对路径，支持项目位于更大仓库之下。`commitGap()` 生成一句话缺项（前 4 个文件 + `git commit -- <paths>`）。 |
| `devagent/src/tools/completion-git.ts`（新） | `deliveryCommitGaps(store, task)`：只读 Task 直接返回空；取最近一次 passed Review 的 `deliveryState.paths`（程序观察所得）与主管会话 cwd，组合出缺项。Review 未绑定交付路径（旧记录）→ 空。 |
| `devagent/src/tools/task-tools.ts` | `endOp` 在调用 `endTask` 之前观察提交；有缺项时把 `store.taskCompletionGaps(...)` 的全部缺项与 git 缺项合并成一次 `COMPLETION_INCOMPLETE` 返回，**不关闭 Task**。 |
| `devagent/src/tools/guidance.ts` | `completionFacts` 把同一判定并入 `gaps`，让 `task(op=get)` / 拒绝返回的 nextActions 与 end 一致。 |
| `devagent/test/git-commit-gate.test.ts`（新，23 例） | 观察器矩阵（无仓库、干净、改动、未跟踪、暂存、空仓库、项目位于更大仓库下、路径外改动、被 .gitignore 排除、被忽略但不存在的路径、内嵌仓库、`.git` 不可读、父仓库不可读、超过单批 200 路径）＋ 缺项分离（忽略与未提交各一条）＋ store 级 gate（已提交/未提交/只读/无绑定路径）＋ 任务工具端到端（未提交时 end 拒绝并列出文件、get 同样列出、提交后缺项消失）。 |
| `docs/productnew/modules/delivery.md` | D-07：提交是收口条件，未提交时任务不能结束并列出文件与动作。 |
| `docs/technicalnew/agents-and-tools.md` | write 完成条件加入「有 Git 时复核覆盖路径相对 HEAD 已提交」，并写明程序只观察与拒绝、不代提交。 |
| `docs/technicalnew/storage-and-recovery.md` | 收口顺序图与说明加入该核对。 |
| `docs/technicalnew/prompts/{chief,settler}.md` | 主管：end 会因未提交而拒绝，自己或结算角色提交后再 end；结算角色：这是被核对的，不是假设。 |
| `docs/technicalnew/ui-design.md` | U1 设计基准行去掉已删除的两轮原型引用。 |

## 判定口径（与 Plan 的偏差：无）

- 门禁只看 Review 覆盖过的路径。`.dev/work/**` 与知识入口可能被项目 gitignore，强行要求会让任务永远收不了口；这是 Plan 里写明的取舍。
- 提交仍由模型执行（主管 bash 或结算角色），程序不代提交——第一步的范围。
- `unverifiable`（有仓库但读不出状态）按缺项阻断，不静默放行；`no-git` 维持本机保存。

## 独立测试发现并已修复（review 前自查）

| 发现 | 处理 |
|---|---|
| 被 `.gitignore` 排除的交付文件 `status` 永远看不到，未提交却放行（High） | 增加 `git check-ignore --stdin -z` 观察；被忽略的交付路径单独列为缺项，给出 `git add -f` 或移出交付两种处置 |
| `.git` 存在但 git 读不出来（broken gitdir / 缺 git 二进制）被判成 `no-git` 静默放行 | 仓库探测失败时若 cwd 下有 `.git` → `unverifiable` 阻断；只有确实不是仓库才是 `no-git` |
| 缺项给出的命令对未跟踪文件不可用（`git commit -- <path>` 会报 pathspec 不匹配） | 文案改为先 `git add -- <paths>` 再提交 |
| 大交付的 pathspec 可能超出 argv 上限 | 路径按 200 一批执行并合并结果（新增 205 路径用例） |
| 独立 Review F-2：交付文件位于项目内嵌的另一个仓库时，外层 `status` 什么都不报，门禁静默放行 | 向上查找每个交付路径所在目录的 `.git`，内嵌仓库列为单独缺项（本项目提交装不下它），提示提交到那个仓库或移出交付 |
| 独立 Review F-3：被忽略文件的建议顺序鼓励了 `git add -f` | 先“移出交付”，再给 `git add -f` 作为规则确实写错时的选择 |
| 独立 Review F-4：主管会话缺 cwd 时静默放行 | 改为一条明确缺项（本版 store 不可达，仍不留静默分支） |
| 独立 Re-review：合法 submodule 的交付永远清不掉缺项（把内层路径交给外层 `status`/`check-ignore` 会 128） | 改为按仓库分组、各自核对；外层对 gitlink 单独判定。新增真实 `git submodule add` 用例（内层提交前 2 条、内层提交后 1 条、指针提交后 0 条） |
| 独立 Re-review：任何名为 `.git` 的文件都被当作内嵌仓库 | 只认 `.git` 目录或 `gitdir:` 指针文件（worktree/submodule 形态） |
| 独立 Test N6：外层 `.gitignore` 排除了内嵌仓库时静默放行 | 仓库根路径也做 `check-ignore`，被忽略记为 `ignored` 并单独成缺项 |
| 独立 Test N9/N9b：两层内嵌时按最深边界分组，外层沉默即放行 | 改为按**最外层**边界分组并递归，两层各有一次“是否记录”的判定（新增两层用例） |

## 证据

- `devagent`: `npx vitest run` → 33 files / 368 tests 全过（新增 23 例）。
- `devagent/webapp`: `npx vitest run` → 31 全过；`tsc --noEmit` 无错误。
- `devagent`: `npm run test:browser` → 40 全过。
- 真实执行：`test/git-commit-gate.test.ts` 的端到端用例在临时 git 仓库里建 Task、记录 passed Review、改动交付文件后调用真实 `task` 工具：返回 `COMPLETION_INCOMPLETE` 且 `gaps` 含 `not committed` 与文件路径，Task 未变为 completed；`git commit` 后同一调用不再出现该缺项。

## 最终设计要点（审查后的形态）

- 仓库判定：`rev-parse --is-inside-work-tree` 成功即 git 项目；失败时**向上**找 `.git`（项目可位于更大仓库之下），找到即 `unverifiable` 阻断（含 git 不可用、gitdir 损坏），只有向上也找不到才是 `no-git`。
- 未提交判定：`git status --porcelain=v1 -z --untracked-files=all -- <paths>`（200 一批），路径用 `rev-parse --show-prefix` 换回项目相对。
- 提交不到的文件：`git check-ignore -z --stdin` 找被忽略的交付路径（只报仍存在的）。
- 内嵌仓库（vendored 目录、submodule）：交付路径按**最外层**边界分组（项目这一层必须记录它，内层交给那个仓库递归核对），在各自仓库里核对；外层对“是否记录了这个仓库”单独判定，并区分“有改动”（`unrecorded`）与“被本项目 `.gitignore` 排除”（`ignored`，本项目的历史永远装不下它）。合法 submodule 交付在“内层已提交 + 外层记录指针”后可以收口。
- 缺项文案给出可执行动作：未提交 → `git add -- <paths>` 后提交；被忽略 → 移出交付，或 `git add -f`。

## 已知限制（写入 Plan 的 out_of_scope）

- 不核对回执里 commit hash 与 HEAD 是否一致（模型自述，未进门禁）。
- 同一文件内用户的手改会与本次交付一起提交（沿用落盘时的文件级摘要口径）。
- 程序不代提交，因此模型仍可能在缺项上反复（可见的拒绝，不是静默跳过）。
