# Test · git-commit-gate-20261025

状态：独立 Test **第五轮（post-fix N6/N9）**。第 0–8 节是第二轮、第 9 节第三轮、第 10 节第四轮快照的记录；**当前结论以第 11 节（最新快照）为准**。
本报告的证据全部来自仓库与自建脚本；未读取任何会话历史；未改动源码、测试或文档。

第一轮结论（旧快照 `git-delivery.ts` = `aa8adf…`，357 例）的三个主要缺口：gitignore 路径静默放行、坏 `.git`/无 git
静默放行、untracked 新文件给出的命令不可用。本轮逐条复查，状态见第 5 节。

## 0. 被测快照（本轮所有结论绑定下列哈希，01:29 复核后未变）

| 文件 | sha256 |
|---|---|
| `devagent/src/runtime/git-delivery.ts` | `d49d9385a35e803a6f43c4a2e425cbe5c198624242277c1e87823b238bc8c88d` |
| `devagent/src/tools/completion-git.ts` | `72354d33f87c730307da8438679f6842b975f51c4f90837ddacdccfdd0b243e7`（与第一轮相同） |
| `devagent/src/tools/task-tools.ts` | `6b04474dd3395ba84191f86c92d53523a89f48cbb519909f914f1ee1fcaecdf8`（相同） |
| `devagent/src/tools/guidance.ts` | `b00cc6b65cf8ef6c6b4f92c23e8677d9df67688381a9d55c4c2d0e6b4141a2d6`（相同） |
| `devagent/test/git-commit-gate.test.ts` | `020bff36ab53ed440fd4ad3f3240ea16053bff7865459fcf178fed49098a8fab`（15 例） |
| `.agentdev/work/git-commit-gate-20261025/implementation.md` | `1b5e7d3672ead8ababe4ec8835da0eae0ff36d37c221d0486e9b6e0cc085c211` |

文档未变（与第一轮同哈希）：`delivery.md` `b48c453b…`、`agents-and-tools.md` `c8066b28…`、
`storage-and-recovery.md` `04d158bc…`、`prompts/chief.md` `afc8af6c…`、`prompts/settler.md` `62b36499…`。

本轮实现变化（读代码确认）：`observeCommit` 新增 `git check-ignore -z --stdin` 得到 `ignored[]`；cwd 下存在 `.git`
而 `rev-parse` 失败 → `unverifiable`（仅无 `.git` 才算 `no-git`）；`commitGap` 用 `'; '` 合并 ignored 与 dirty 两条事实，
dirty 文案改为 `stage them (\`git add -- <paths>\`), commit, then end again`，ignored 文案为
`add them with \`git add -f -- <paths>\` or keep them out of the delivery`。

## 1. 命令与精确计数（均在 `devagent/`，webapp 除外）

| 命令 | 结果 |
|---|---|
| `npx vitest run`（01:27） | **Test Files 33 passed (33)，Tests 360 passed (360)**，Duration 19.58s |
| `npx vitest run test/git-commit-gate.test.ts`（01:29） | 1 file passed，**15 tests passed (15)** |
| `npx tsc --noEmit`（01:27） | 无诊断输出，退出码 0（`tsc: 0 errors`） |
| `cd webapp && npx vitest run`（01:29） | 4 files passed，31 tests passed (31) |

`implementation.md` 本轮已同步为「15 例 / 33 files / 360 tests」，与实测一致。
未执行：`npm run test:browser`（40 例）——与本改动无关的 UI 套件，且命令需要先构建 webapp 再起 Playwright；
「40 全过」在本报告中不被背书。

## 2. 复现方式（仍不使用新测试文件）

自建脚本 `/tmp/gitgate-probe/probe.ts`（`node --experimental-strip-types` 跑 TS），**只 import 生产模块**
（`store.ts` / `task-tools.ts` / `completion-git.ts` / `git-delivery.ts` / `deliverable.ts`），不 import
`test/git-commit-gate.test.ts`，也不复用其 helper。22 个场景共用同一构造：

1. 临时目录 `git init` + 基线 `src/a.ts` 并提交；
2. `new Store` → `createProject(realPath)` → `createSession(roleId:'chief', cwd)` → `acceptInput` 一条真实用户决定输入；
3. `createTaskTool(contextGetter, { chief: true })`，**真实调用** `op:'create'`（write，`requiresTest:false`）；
4. 改交付文件后 `updateTask(phase:'review')` → reviewer 成员 → `claimNextInput` → `recordResult(kind:'review',
   verdict:'passed', deliveryState:{paths,digest:digestOfPaths(...)})` → `finishInput`；
5. **真实调用** `op:'end'`，记录 `code` / `gaps` / `store.getTask().status`；
6. 需要正常收口时按同样方式记 `kind:'settlement'`，再 `end`。

唯一不真实的是没有 Pi 模型会话在环上驱动 prompt 与 bash；工具入口、store、git 仓库都是真实的。

## 3. 场景矩阵（观察值原样摘录）

### A. 基线（回归）：已通过 Review、文件改动未提交 → end；提交 → end

```
deliveryCommitGaps: ["the reviewed delivery is not committed: 1 file(s) with uncommitted changes (src/a.ts); stage them (`git add -- <paths>`), commit, then end again"]
end#1 code: COMPLETION_INCOMPLETE，end#1 task status: active
task get gaps: [同一条 not committed, "no settlement report is recorded"]
literal `git commit -- src/a.ts`（已跟踪文件）ok: true → gate []
end#3（已记 settlement）code: (no error code)，gaps: []，status: completed
```

- 新文案已生效（`stage them (git add -- <paths>)`）；`get` 与 `end` 仍用同一判定。

### B. 复核覆盖的文件被删除

```
observeCommit: {"mode":"git","dirty":["src/a.ts"],"ignored":[]}
end gaps: ["the delivery changed after the last passed review (r-review); ...", "completion result ...", "the reviewed delivery is not committed: ... (src/a.ts); stage them ..."]
task status: active
提交删除后：deliveryCommitGaps: []，end gaps 仅剩 ["the delivery changed after the last passed review (r-review) ..."]，status: active
```

- 仍与第一轮一致：git 门禁正确，但删除/改名提交后需重新复核才能收口（既有摘要口径，非本次门禁缺陷）。

### C. 复核覆盖的文件被改名（git mv）

```
git status --porcelain: R  src/a.ts -> src/b.ts
observeCommit([src/a.ts]).dirty = ["src/a.ts"]；observeCommit([src/b.ts]).dirty = ["src/b.ts"]
end gaps: [摘要缺项, completion result, not committed (src/a.ts) ...]
提交改名后 deliveryCommitGaps: []，end gaps 仅剩摘要缺项，status: active
```

- 同上：git 侧正确，摘要侧要求重新复核。

### D. 已暂存未提交

```
git status --porcelain: M  src/a.ts
observeCommit: {"mode":"git","dirty":["src/a.ts"],"ignored":[]}
end code: COMPLETION_INCOMPLETE，task status: active；提交 index 后 gate []
```

### E. 项目位于更大仓库的子目录

```
observeCommit(project,[src/a.ts]): {"mode":"git","dirty":["src/a.ts"],"ignored":[]}
end gaps: [completion result, not committed (src/a.ts) ...]；end status: active
git commit -- src/a.ts（项目目录内）ok → gate []；仓库其余改动（apps/web/docs/x.md、other/notes.txt）不触发缺项
end 只剩 ["completion result ..."]
```

### F. 项目没有 git

```
observeCommit: {"mode":"no-git","head":null,"dirty":[],"ignored":[]}
deliveryCommitGaps: []；end code: (no error code)，status: completed
```

### G. 复核两条路径、只提交一条

```
end gaps: [completion result, "the reviewed delivery is not committed: 1 file(s) ... (src/b.ts); stage them ..."]
task status: active；两条都提交后 gate []
```

### H. 复核覆盖的路径被 gitignore（第一轮缺口 1）

```
git status --porcelain: ?? .dev/                       ← 被忽略文件依旧不出现在 status
observeCommit(repo,[dist/app.js]): {"mode":"git","dirty":[],"ignored":["dist/app.js"]}
deliveryCommitGaps: ["the reviewed delivery contains 1 ignored file(s) that can never be committed (dist/app.js); add them with `git add -f -- <paths>` or keep them out of the delivery"]
end code: COMPLETION_INCOMPLETE；end gaps: [上面这一条]；task status: active
file ever tracked? false
git add -f -- dist/app.js ok → git commit -- dist/app.js → gate [] → end code: (no error code)，status: completed
```

- **缺口 1 已关闭**：ignored 交付路径现在阻断收口，文案给出可执行动作，照做后可收口。

### H2. 同一复核集合里既有 ignored 又有 modified

```
observeCommit: {"mode":"git","dirty":["src/a.ts"],"ignored":["dist/app.js"]}
commitGap: "the reviewed delivery contains 1 ignored file(s) ... (dist/app.js); ... ; the reviewed delivery is not committed: 1 file(s) ... (src/a.ts); stage them ..."
end code: COMPLETION_INCOMPLETE；end gaps: [completion result, 上述整句]，task status: active
```

- 观察：两条事实被合成**一个** gap 元素（`'; '` 连接），`gaps` 数组项数不反映「两个问题」；不影响可读性与阻断。

### I. cwd 里有 `.git` 但仓库读不出来（第一轮缺口 2 的直接形态）

```
git rev-parse: fatal: not a git repository: /nonexistent/definitely/not/here
observeCommit: {"mode":"unverifiable","head":null,"dirty":[],"ignored":[],"detail":"fatal: not a git repository: /nonexistent/definitely/not/here"}
deliveryCommitGaps: ["the delivery could not be checked against git (...); restore git, commit the delivery, then end again"]
end code: COMPLETION_INCOMPLETE；task status: active
```

- **缺口 2 的这一形态已关闭**：不再是 `no-git`，阻断并说明原因。

### I2. 项目是「坏仓库」的子目录（本轮新发现的残留）

```
git rev-parse（项目子目录）: fatal: not a git repository: /nonexistent/definitely/not/here
项目 cwd 下存在 .git？false
observeCommit: {"mode":"no-git","head":null,"dirty":[],"ignored":[]}
commitGap: null；deliveryCommitGaps: []
end code: (no error code)；end gaps: []；task status: completed
```

- **缺口 2 的残留（未关闭）**：`existsSync(join(cwd,'.git'))` 只看 cwd 自身，父目录里的坏 `.git` 不在视野内，
  于是「仓库存在但读不出来」在子目录项目上仍被当作本机保存项目，静默收口。

### J. 复核覆盖的是新文件（untracked）

```
end code: COMPLETION_INCOMPLETE
end gaps: [completion result, "the reviewed delivery is not committed: 1 file(s) ... (src/new.ts); stage them (`git add -- <paths>`), commit, then end again"]
task status: active
旧式 `git commit -- src/new.ts`：ok = false（pathspec did not match）——已不再是建议动作
建议动作 `git add -- src/new.ts`：ok = true → `git commit` ok = true → gate []
```

- **缺口 3 已关闭**：文案先 stage 再 commit，实测两步可执行且清空缺项。

### K. 项目是仓库根，但 PATH 里没有 git

```
observeCommit（PATH=/nonexistent-git-path）: {"mode":"unverifiable","head":null,"dirty":[],"ignored":[],"detail":"git is not installed"}
commitGap: "the delivery could not be checked against git (git is not installed); restore git, commit the delivery, then end again"
```

- **缺口 2 的这一形态已关闭**（阻断并给出原因）。

### K2. PATH 里没有 git，且项目是仓库的子目录（本轮新发现的残留）

```
observeCommit（子目录 cwd，git 不可用）: {"mode":"no-git","head":null,"dirty":[],"ignored":[]}
commitGap: null
end code: (no error code)；end gaps: []；task status: completed
仓库实际状态（PATH 恢复后）: M apps/web/src/a.ts
```

- **缺口 2 的残留（未关闭）**：子目录 cwd 没有 `.git`，ENOENT 仍归为 `no-git`；一个真实仓库里有未提交的复核交付，
  任务却 completed。Plan 风险写的是「git 命令不可用但仓库存在 → 阻断」。

### T. 已跟踪文件虽匹配 ignore 规则，但不该误报（新实现的假阳性检查）

```
observeCommit（tracked，clean）: {"mode":"git","dirty":[],"ignored":[]}
observeCommit（tracked，modified）: {"mode":"git","dirty":["dist/app.js"],"ignored":[]}
commitGap: the reviewed delivery is not committed: 1 file(s) ... (dist/app.js); stage them ...
```

- 观察：`check-ignore` 默认跳过已跟踪文件，未出现「已跟踪却被当成 ignored」的假阳性。

### O. 复核路径数 205（超过单批 200）

```
observeCommit dirty: ["src/f001.ts","src/f204.ts"]
end gaps: [completion result, "the reviewed delivery is not committed: 2 file(s) ... (src/f001.ts, src/f204.ts); stage them ..."]
task status: active；提交后 gate []
```

### O2. ignored 检测跨批次（205 路径，第 1 批与第 2 批各有被忽略项）

```
ignored: ["src/f001.ts","src/f204.ts"]
dirty count: 203
end gaps: [completion result, "the reviewed delivery contains 2 ignored file(s) ... (src/f001.ts, src/f204.ts); ...; the reviewed delivery is not committed: 203 file(s) ... (src/f000.ts, src/f002.ts, src/f003.ts, src/f004.ts and 199 more); stage them ..."]
task status: active
```

- 观察：ignored 也按批合并，边界两批都被发现；`summarize` 前 4 + `and N more` 正常。

### P. 空仓库（unborn HEAD）

```
observeCommit: {"mode":"git","head":null,"dirty":["src/a.ts"],"ignored":[]}
commitGap: ... 1 file(s) with uncommitted changes (src/a.ts); stage them ...
```

### L. 路径含空格

```
observeCommit: {"mode":"git","dirty":["src/with space.ts"],"ignored":[]}
end code: COMPLETION_INCOMPLETE；task status: active
```

### M. 仓库可识别但 status 失败（索引损坏）

```
observeCommit: {"mode":"unverifiable","head":"6e0c1b69…","dirty":[],"ignored":[],"detail":"fatal: .git/index: index file smaller than expected"}
commitGap: ... restore git, commit the delivery, then end again
```

### U. 复核路径被忽略且文件不存在（新文案的可执行性边界）

```
observeCommit(repo,[dist/gone.js]): {"mode":"git","dirty":[],"ignored":["dist/gone.js"]}
commitGap: ... 1 ignored file(s) ... (dist/gone.js); add them with `git add -f -- <paths>` ...
git add -f -- dist/gone.js ok: false
```

- 观察：被忽略的**不存在**路径也会被 `check-ignore` 报出，文案建议的 `git add -f` 对不存在的文件失败。
  实际链路里这种情况一定同时被摘要门禁拦住（复核文件消失 → delivery changed），所以是误导性文案而非放行缺口。

### N. 无 Review / Review 未绑定路径 / 只读 Task

```
write task, no review: []
write task, review without paths: []
read task view: []
commitGap(no-git): null
commitGap(unverifiable): the delivery could not be checked against git (boom); ...
```

## 4. 与第一轮相比新增/保持的行为

新增：`ignored[]` 观察与阻断；cwd 内 `.git` 不可读 → `unverifiable`；dirty 文案先 stage；ignored 与 dirty 合并文案；
分批覆盖 status 与 check-ignore 两条命令；已跟踪文件不误报 ignored。

保持：无仓库 → 本机保存放行；只读 Task / 无 Review / 无绑定路径 → 不产生缺项；路径外改动不触发；嵌套仓库前缀映射；
删除/改名提交后仍需重新复核（摘要门禁）；`commitGap` 前 4 + `and N more`；`end` 拒绝时 Task 保持 `active`。

## 5. 第一轮 finding 的关闭状态

| # | 第一轮 finding | 本轮状态 | 证据 |
|---|---|---|---|
| 1 | 被 gitignore 的复核交付路径静默收口（与 D-07 冲突） | **CLOSED**：`ignored[]` 阻断、文案可执行、`git add -f` 后收口；已跟踪文件不误报 | H、H2、T |
| 2 | 坏 `.git` / 无 git 被当作 `no-git` 静默放行 | **部分关闭**：cwd 内有 `.git` 的坏仓库、仓库根 + git 缺失都改为 `unverifiable` 阻断（I、K）；**残留未闭**：项目是子目录时（父 `.git` 坏 / git 缺失）仍 `no-git`，`end` 完成（I2、K2） | I、K、I2、K2 |
| 3 | untracked 新文件的建议命令 `git commit -- <paths>` 不可用 | **CLOSED**：文案改为先 `git add -- <paths>` 再 commit，实测两步清空缺项；旧的 `commit -- path` 仍失败但不再被建议 | J |
| 4 | 删除/改名提交后仍被摘要门禁拦住，需重新复核 | **未变（既有口径）**：不是本次门禁缺陷，仍建议在 D-07 写明 | B、C |
| 5 | `implementation.md` 说 12 例而实际 13 例 | **CLOSED**：现为「15 例 / 360 tests」，与实测一致 | 第 1 节 + implementation.md |

## 6. Plan 步骤判定（当前快照）

| 步骤 | 判定 | 依据 |
|---|---|---|
| **G1** `runtime/git-delivery.ts` 观察器 | **PASS**：Plan 五项（无仓库→no-git；干净→无缺项；改动/未跟踪→有缺项；路径外改动不触发；空仓库）全部独立复现；新增 ignored 观察、分批、readable-but-failing → `unverifiable` 也符合 Plan 的「无法核实比假通过安全」。残留：I2/K2 的仓库判定只看 cwd 自身 | A/D/E/F/H/H2/I/K/M/O/O2/P/T |
| **G2** `completion-git.ts` 组合判定 | **PASS**：无 Review、无绑定路径、只读 Task 均不产生缺项；latest passed review 的 paths 与主管 cwd 组合正确（A/E/H2）；文件未变（哈希同第一轮）。`deliveryState = null` 仍无法经 API 构造，仅以空 paths 等价分支与代码确认 | N + A/E/H2 |
| **G3** `endOp` + `guidance.completionFacts` | **PASS**：ignored / dirty / unverifiable 三种缺项都使 `end` 返回 `COMPLETION_INCOMPLETE` 且 Task 保持 `active`（A/B/D/G/H/H2/I/J/L/O/O2）；提交（含 `git add -f`、先 stage 新文件）后缺项消失（A/D/E/G/H/J/O）；满足时正常 `completed`（A/F）——**除 I2/K2 两组残留分类**；`get` 与 `end` 同一判定（A） | A–U |
| **G4** 契约与提示词同步 | **FAIL（残留，范围已收窄）**：无「程序代为提交」表述（`docs/productnew`+`docs/technicalnew` 下 grep 命中为空；唯一命中在 `docs/old/` 归档且语义是「不得自动提交」；代码 git 只执行 `rev-parse`/`status`/`check-ignore`）；D-07 与现在的 ignored 行为一致。但 `agents-and-tools.md` 仍写「仓库存在但读不出来按缺项阻断，不静默放行」——反例 I2/K2（子目录项目下仓库存在却不可读/不可用，静默收口）；同一句的括号枚举（「仓库判定、HEAD、这些路径的 dirty 集合」）未包含新的 `check-ignore`/`ignored` 事实。文档本轮未改（哈希同第一轮） | I2/K2 + 文档 diff + grep |

## 7. 仍未关闭的缺口（按严重度）

1. **I2 / K2（中）**：仓库判定只看 `cwd/.git`。项目是仓库子目录时，「父目录 `.git` 坏」与「git 不可用但仓库存在」
   都退回 `no-git`，`end` 静默完成（K2 实测仓库里确有未提交的复核文件）。建议向上探测 `.git`（或对 ENOENT/rev-parse
   失败在存在任意祖先 `.git` 时判 `unverifiable`），否则把文档改成只承诺 cwd 级判定。
2. **U（低）**：ignored 消息对「被忽略且不存在」的路径建议 `git add -f`，该命令必然失败；实际仍被摘要门禁拦住，
   属误导性文案。可考虑区分「ignored 且存在」与「ignored 且缺失」。
3. **H2/O2 表达（低）**：ignored 与 dirty 被拼成一个 gap 元素，`gaps` 长度不反映问题数；机器消费方若按数组项计数会少算。
   人读文本无歧义。
4. **B/C（低，既有口径）**：删除/改名提交后必须重新 Review 才能收口，建议写进 D-07 的提交小节。
5. **G4 文档同步（中低）**：上述 I2/K2 与 ignored 枚举两点需要文档与实现二选一对齐；本轮文档哈希未变。

## 8. 未能验证的事项

1. **`Review 无 deliveryState`（G2 第二项）**：`recordResult` 对 review 强制要求 `deliveryState`，该状态只能来自旧数据；
   我用空 paths 验证等价分支并读代码确认 null 同路径，但没有构造真实 `deliveryState = null` 行。
2. **Pi 模型会话在环**：脚本直接调同一 task 工具入口，未验证 `prompts/chief.md`、`prompts/settler.md` 的引导在真实
   回合中是否被模型照做。
3. **结算报告/commit 回执整链条**（settlement 文件体、回执写 DB）未执行；只验证「settlement 已记录」是收口前提。
4. **浏览器套件 40 例**未执行（见第 1 节）。
5. **每次 task 工具调用多一次 git 观察的开销**：`guidanceFor → completionFacts → deliveryCommitGaps` 在
   create/get/update/control/adopt/拒绝路径都会被调用；现在每批路径还要多一次 `check-ignore`。未测延迟；超时 5s，
   失败即 `unverifiable` 阻断（代码路径已读）。
6. **Windows/路径编码**：`check-ignore --stdin` 的 NUL 分隔在 darwin 上验证，未在其他平台验证。

## 9. 最终轮（第三轮，最新快照）

### 9.1 快照与计数

| 文件 | sha256 |
|---|---|
| `devagent/src/runtime/git-delivery.ts` | `10900831032f446e99785cfb86eb2ec404090491568a361c59cda0ba38aabc76` |
| `devagent/src/tools/completion-git.ts` | `54dcf07f4d0434d3ee2cf65ed10dc063570a1e60449d402bb81990811bc45a4a` |
| `devagent/src/tools/task-tools.ts` / `guidance.ts` | `6b04474d…` / `b00cc6b6…`（未变） |
| `devagent/test/git-commit-gate.test.ts` | `5260ff5cc2c5a425492fa12168e79edcf7e3bd98afb0d8a8b4f7a94c7518b40b`（19 例） |
| `.agentdev/work/.../implementation.md` | `8613c4ba59eaaeb4164407576736cd63f0d58f4ed28c22d16c8e9b0c46563050` |
| `docs/productnew/modules/delivery.md` | `4ba6f0763a14ed66541e1a5ce061c6f0e8aa401a3b7f4d7c7dc1616beed83f79` |
| `docs/technicalnew/agents-and-tools.md` | `da64d875f31e3acc2fd03c01505098b0c89fa1b593dd4b659f2d2e59605eda09` |

`storage-and-recovery.md` / `prompts/chief.md` / `prompts/settler.md` 未变（哈希同第 0 节）。

| 命令 | 结果 |
|---|---|
| `npx vitest run`（02:04） | **33 files / 364 tests passed** |
| `npx vitest run test/git-commit-gate.test.ts`（02:05） | **19 tests passed** |
| `npx tsc --noEmit`（02:04） | 无诊断，退出码 0 |
| `cd webapp && npx vitest run`（02:07） | 4 files / 31 tests passed |

浏览器套件 40 例仍未执行（理由同第 1 节）。探针脚本 `/tmp/gitgate-probe/probe.ts` 本轮扩到 **29 个场景**，
仍只 import 生产模块、不 import 测试文件；构造方式同第 2 节（真实 store + 真实 task 工具 + 真实 git 仓库）。

### 9.2 本轮四项变化的验证

1. **内嵌仓库**：`observeCommit` 新增 `nested[]`，`commitGaps` 单独成项。V1/V3 证明检测与阻断；V1/V2 证明**内层提交
   并不解除门禁**，V5 证明「移出交付」（重新复核时不含该路径）才解除——因此缺项文案的第一选项「commit them in that
   repository」是误导，只有第二选项有效（见 9.4）。
2. **ignored 文案**：先建议「keep them out of the delivery」，`git add -f` 作为「ignore 规则错了」的刻意替代（H）。
3. **无 cwd 的显式缺项**：store API 正常路径不可达；我用真实 store + 真实 Task 行、把 `chiefSessionId` 换成不存在的
   session 走同一分支（W），得到 `the project directory of this Task is unknown...`，不再静默通过。
4. **D-07 措辞**：现在写「把未提交文件与所需动作返回给主管」，`docs/productnew`、`docs/technicalnew` 下
   grep「工作台列出…未提交」无命中，无浏览器界面承诺。

另外：缺项已拆成独立数组项（ignored / nested / dirty 各一条），第二轮「合并成一个 gap 元素」的问题消失（H2、V3）。

### 9.3 场景结果（缺项与 Task 状态）

| 场景 | 观察到的缺项 | Task 状态 |
|---|---|---|
| A 基线：改动未提交 → end → 提交 → end | `not committed (src/a.ts); stage them…` → 提交后消失 | `active` → `completed` |
| B 复核文件被删除 | 摘要缺项 + `not committed`；提交删除后只剩摘要缺项 | `active` |
| C 复核文件改名 | 摘要缺项 + `not committed (src/a.ts)`；提交改名后只剩摘要缺项 | `active` |
| D 已暂存未提交 | `not committed (src/a.ts)`；提交 index 后消失 | `active` |
| E 项目在更大仓库子目录 | `not committed (src/a.ts)`；项目内/仓库其他改动不触发 | `active` |
| F 无 git | 无 | `completed` |
| G 两条路径只提交一条 | `not committed (src/b.ts)` | `active` |
| H 被忽略路径 | `contains 1 ignored file(s) …keep them out…or git add -f…`；`add -f` + commit 后消失 | `active` → `completed` |
| H2 ignored + modified | 两条独立缺项（ignored、not committed） | `active` |
| I cwd 内坏 `.git` | `could not be checked against git (fatal: not a git repository…)` | `active` |
| I2 子目录、父 `.git` 坏 | 同上（第二轮会静默 `completed`） | `active` |
| J untracked 新文件 | `not committed (src/new.ts); stage them…`；`git add --` + commit 后消失 | `active` |
| K 仓库根、git 不在 PATH | `could not be checked against git (git is not installed)` | 阻断 |
| K2 子目录、git 不在 PATH（仓库确有 `M apps/web/src/a.ts`） | 同上（第二轮会静默 `completed`） | `active` |
| T 已跟踪但匹配 ignore | 不误报 ignored；改动时按 dirty 报 | — |
| O / O2 205 路径分批 | dirty 跨批正确；ignored 跨批正确（O2 两批各一） | `active` |
| L 路径含空格 | `not committed (src/with space.ts)` | `active` |
| M 索引损坏 | `could not be checked against git (index file smaller…)` | 阻断 |
| P 空仓库 | `not committed (src/a.ts)` | 阻断 |
| N 无 Review / 无路径 / 只读 | 均无缺项 | — |
| **V1 内嵌仓库 + 外层改动** | `nested (vendor/lib)` + `not committed (src/a.ts)`，共 2 条 | `active` |
| **V2 只交付内嵌仓库文件** | `nested (vendor/lib)`；内层提交 + 外层 gitlink 后仍拒绝（但文案退化为 unverifiable，见 9.4） | `active` |
| **V3 ignored + nested + dirty** | 3 条独立缺项，顺序 ignored → nested → dirty | `active` |
| **V4 子模块式 gitlink 已在 HEAD** | `unverifiable: Pathspec 'vendor/lib/a.txt' is in submodule 'vendor/lib'`，nested 信息丢失 | 阻断但原因误导 |
| **V5 重新复核并移出 nested 路径** | 首次复核含 nested 路径 → `unverifiable (Pathspec … is in submodule …)`；重复核只含 `src/a.ts` 后 `gaps: []` | `completed` |
| **W 无 cwd 分支** | `the project directory of this Task is unknown…` | 模块级验证 |
| **X 目录里只是普通 `.git` 文件** | 误报 `nested (weird)`；实际该文件仍可由外层提交（`git status` 正常 `M weird/x.txt`） | 误报 |
| **内嵌仓库缺项文案的第一选项「commit them in that repository」** | 实测无效：内层提交后 nested 缺项仍在（V1、V2）；只有移出交付才解除（V5） | 文案误导（见 9.4） |

### 9.4 上一轮 finding 的关闭状态与本轮新发现

| 项 | 状态 | 证据 |
|---|---|---|
| I2 / K2 子目录项目仍静默 `no-git` | **CLOSED**：`repositoryMarker` 向上找 `.git`，两例都变 `unverifiable` 且 end 拒绝；文档同步写明 | I2、K2、agents-and-tools |
| U「被忽略且不存在」仍建议 `git add -f` | **CLOSED**：ignored 只报仍存在的路径；`dist/gone.js` → `ignored: []`、无缺项 | U |
| ignored + dirty 被拼成一个 gap 元素 | **CLOSED**：拆成独立数组项（H2 两条、V3 三条） | H2、V3 |
| G4：文档「仓库读不出来一律阻断」与实现不符 | **CLOSED**：文档已改为「向上查找 `.git`、找到但读不出一律阻断」，与 I/I2/K/K2 实测一致 | 文档 + I/K/I2/K2 |
| B/C 删除/改名提交后仍需重新复核 | **未变（既有口径）**，仍建议在 D-07 写明 | B、C |
| **新 V4：nested 仓库被记为 gitlink/submodule 后，`git check-ignore` 以 128 失败**（`fatal: Pathspec … is in submodule`），`observeCommit` 变 `unverifiable`，nested 缺项被换成「restore git, commit the delivery」 | **OPEN（中低）**：仍然阻断（不会误放行），但原因误导；建议把 check-ignore 的 submodule 失败降级为「该路径属于 nested 仓库」并保留 nested 判定，或先算 nested 再决定是否跳过 check-ignore | V4、V2、隔离实验（`check-ignore` 对 gitlink 内路径 exit 128） |
| **新 X：目录中任意名为 `.git` 的条目（哪怕不是仓库）都判为 nested** | **OPEN（低）**：误报一条不可执行的缺项；删掉那个假 `.git` 即可解除。可改为用 `rev-parse --git-dir` 验证 | X |
| **新：`agents-and-tools.md` 括号枚举仍未含 nested；且「被忽略的文件进不了提交」与 `git add -f` 可提交矛盾** | **OPEN（文档小差异）**：D-07 已覆盖 nested，行为无误，只是技术文档枚举不完整/措辞过绝对 | 文档 diff |
| **新：nested 缺项文案的第一选项「commit them in that repository」无效**，只有「keep them out of the delivery」能解除 | **OPEN（文案）**：V1/V2 内层提交后仍拒绝；V5 移出交付后 `gaps: []`；建议改成「该路径不能进本次交付：把它从交付中移除（重新复核），或明确改交付范围」 | V1、V2、V5 |

### 9.5 Plan 判定（最新快照）

| 步骤 | 判定 |
|---|---|
| **G1** 观察器 | **PASS**：原五项 + ignored / nested / 向上仓库标记 / 分批 / `unverifiable` 均独立复现。残留 V4、X 属分类与误报细节，非放行 |
| **G2** 组合判定 | **PASS**：无 Review / 无路径 / 只读不产生缺项；latest passed review 的 paths + 主管 cwd 组合正确；新增无 cwd 显式缺项（W）。`deliveryState = null` 仍只能代码级确认 |
| **G3** end + guidance | **PASS**：ignored / nested / dirty / unverifiable 都使 end 返回 `COMPLETION_INCOMPLETE`、Task 保持 `active`；stage、`add -f`、移出交付（V5）可清空对应缺项；内层提交本身不清空（V1/V2）；满足时 `completed` |
| **G4** 契约同步 | **PASS（含 9.4 两处文档小差异）**：D-07 与实现一致且不再承诺浏览器界面；技术文档的「向上找 `.git`、读不出一律阻断」经 I/I2/K/K2 验证成立；无「程序代为提交」表述（`docs/productnew`+`docs/technicalnew` grep 为空） |

### 9.6 仍未验证

第 8 节的六项仍然成立（`deliveryState = null` 不可构造、无 Pi 模型在环、结算/回执链条、浏览器套件、git 观察开销、
Windows 路径）。本轮 V1/V2/V5 走了完整 end；V4 的 `check-ignore` 128 另做了命令行隔离实验；W、X 为模块级验证。
仍未验证：真实模型回合里主管如何消化 V4 的误导文案，以及 V5 路径在真实流程中由谁发起重新复核。

## 10. 最终嵌套轮（第四轮，最新快照）

### 10.1 快照与计数

| 文件 | sha256 |
|---|---|
| `devagent/src/runtime/git-delivery.ts` | `c1580d5ee2a0a19ba7f5e22f54e073b7d6d0cb08ff1a50ec2ec31a1b738aaf99` |
| `devagent/src/tools/completion-git.ts` | `54dcf07f4d0434d3ee2cf65ed10dc063570a1e60449d402bb81990811bc45a4a`（未变） |
| `devagent/src/tools/task-tools.ts` / `guidance.ts` | `6b04474d…` / `b00cc6b6…`（未变） |
| `devagent/test/git-commit-gate.test.ts` | `2cb870d419b355bcbae1d56fd9812b87e7f116163b4326f1553146b59ad9f508`（21 例） |
| `.agentdev/work/.../implementation.md` | `b354019d63dc97b9b9089b1a6f792ec50e1a7aeac25a30b626fd3680c0ab214f` |
| `docs/productnew/modules/delivery.md` | `4ba6f076…`（未变） |
| `docs/technicalnew/agents-and-tools.md` | `c2cbd62297ce60de44bef61076215ad9747e1584fc826ddbc43207e7bded6de9` |

| 命令 | 结果 |
|---|---|
| `npx vitest run`（02:23） | **33 files / 366 tests passed** |
| `npx vitest run test/git-commit-gate.test.ts`（02:24） | **21 tests passed** |
| `npx tsc --noEmit`（02:23） | 无诊断，退出码 0 |
| `cd webapp && npx vitest run`（02:26） | 4 files / 31 tests passed |

浏览器套件 40 例仍未执行。探针脚本本轮 **35 个场景**（A–X、N1–N9b），仍只 import 生产模块。

### 10.2 请求的三组嵌套场景

| 场景 | 观察到的缺项 | Task 状态 |
|---|---|---|
| **N1** 内嵌仓库（非 submodule），内层文件未提交、外层未记录 | 2 条：`not recorded as committed in this project`；`inside nested repository vendor/lib: ... not committed (a.txt)` | `active` |
| **N2** 内层已提交、外层仍不记录 | 1 条：`not recorded as committed in this project` | `active` |
| **N3** 外层 `git add vendor/lib` 但未提交 | 1 条（同上）；提交指针后 `gaps: []` | `active` → `completed` |
| **N4 step1** 真 `git submodule add`，内层工作树脏 | 2 条：not recorded + inside not committed；**无 128/unverifiable** | `active` |
| **N4 step2** 内层提交、指针过期 | 1 条：not recorded | `active` |
| **N4 step3** `git add vendor/lib` + commit | 0 条 | `completed` |
| **N5** 指针已提交，submodule 工作树脏（新 Task） | 2 条：`not recorded as committed`（**措辞不准**，见 10.4）+ inside not committed | `active` |
| **N6** 外层 `.gitignore` 排除内嵌仓库，内层已提交 | **0 条** | **`completed`（未阻断）** |
| **N7** 两个内嵌仓库（a 干净未记录、b 内层脏）+ 外层脏文件 | 4 条（外层 dirty、a not recorded、b not recorded、inside b dirty） | `active` |
| **N7b** 先记录 a 与外层文件，再记录 b | 2 条 → 0 条 | `active` → `completed` |
| **N8** 内嵌目录 `.git` 指向不存在的 gitdir | 2 条：外层把它当普通文件报 dirty；inside unverifiable | `active` |
| **N9** 两层嵌套，外层未记录任何一层（中间层已记录内层） | **0 条** | **`completed`（未阻断）** |
| **N9b** 两层嵌套，外层与中间层都未记录下一层 | **0 条**；实测外层 `?? vendor/`、中间层 `?? vendor/` | **`completed`（未阻断）** |

A–H 回归：与上一轮一致。A 拒绝 → 提交后 `completed`；B/C 摘要门禁仍要求重新复核；D 暂存仍算未提交；E 前缀映射与无关改动隔离正常；
F 无 git 正常收口；G 只报未提交的那条；H/H2 ignored 与 dirty 各自成条；`X` 的假 `.git` 文件不再被当成 nested（`nested: []`，本轮修复）。

### 10.3 明确结论：有复核已通过但未被阻断的情形

**不是每个「复核覆盖的内容不在项目提交里」的情形都被阻断。** 本轮实测到三个以 `completed` 结束的反例，均为嵌套仓库的
「外层是否记录」判定：

1. **N6（外层 `.gitignore` 排除嵌套仓库）**：外层 `status` 对被忽略的 `vendor/lib` 保持沉默，于是 `recorded = true`；内层已提交、
   工作树干净 → 0 缺项。外层仓库的提交永远不会包含或指向这份交付，与 D-07「位于项目内嵌的另一个仓库里时任务不能结束」相反。
2. **N9 / N9b（多层嵌套）**：分组根取的是**最近**的 `.git`（`vendor/a/vendor/b`），外层拿这个深层路径去 `status` 时已落在
   嵌套边界之内，git 同样沉默 → `recorded = true`。N9b 里外层与中间层都明确报告 `?? vendor/`（两层都没记录），门禁仍 0 缺项收口。

以上三例中，被复核文件确实已在内层仓库提交，但「外层项目记录这个仓库」这一事实为假，门禁把它误判成真。
其余「普通文件未提交 / 被忽略 / 内层未提交 / 指针未提交」的情形（A–H、I–U、N1–N5、N7、N8）都被阻断。

### 10.4 其他观察（不导致放行）

- **N5 措辞**：submodule 指针已在 HEAD、只有工作树脏时，`git status` 报 ` M vendor/lib`，实现把它算作
  `recorded = false`，于是多出一条「is not recorded as committed in this project」。第一句与事实不符（指针已记录），
  但该状态同时命中 inside 的 dirty 缺项，仍然阻断；两步骤建议（先内层提交、再记录指针）仍可执行。
- **N8**：`gitdir:` 指向不存在的内层仓库时，外层把它当普通目录（`vendor/lib/a.txt` 报 dirty），同时内层 `unverifiable`；
  两条都阻断，属过度但不误放行。
- **N7 标签**：`inside nested repository vendor/a: …` / 各自 `git add -- vendor/a`，指向正确；两个仓库不会互相覆盖。
- `commitGaps` 的第二参数（`inside`）把内层缺项加前缀，外层与内层事实不再混淆；`.git` 标记校验（目录或 `gitdir:` 指针文件）
  修掉了第三轮的 X 误报。

### 10.5 Plan 判定（本快照）

| 步骤 | 判定 |
|---|---|
| **G1** 观察器 | 原五项（无仓库/干净/改动/路径外/空仓库）**PASS**；ignored、向上仓库标记、分批、`unverifiable` **PASS**；**nested 的「外层是否记录」判定 FAIL**：N6、N9/N9b 把未记录当已记录 |
| **G2** 组合判定 | **PASS**：无 Review / 无路径 / 只读 / 无 cwd 分支均按设计；嵌套分组与逐仓核对按 N1–N9b 的观察值实现 |
| **G3** end + guidance | 普通未提交与 ignored 路径 **PASS**（A–H、N1–N5、N7、N8 都拒绝并保持 `active`）；**nested 记录缺项在 N6/N9/N9b 未产生，按 D-07 的完成条件判 FAIL** |
| **G4** 契约同步 | 文档新增「内嵌仓库里的交付文件…外层项目有没有记录这个仓库另算一条，submodule 的合法形态因此可以正常收口」，与 N1–N5/N7 一致；但该句对 N6/N9b 不成立（另算的那一条没有出现），属文档承诺强于行为 |

> 本节（第 10 节）的 N6/N9/N9b 结论已被第 11 节取代：这三例在新快照中都被阻断。

### 10.6 未验证

1. 内层仓库**自己的** `.gitignore` 排除复核文件（应走 `inside nested repository … ignored` 分支）未单独构造；逻辑与外层相同，但未实测。
2. N6 的等价形态（`.git/info/exclude`、全局 excludesFile）未实测，推断同因。
3. 三层以上嵌套、嵌套仓库内再出现 submodule 的组合未测。
4. 第 8 节六项仍未验证（`deliveryState = null` 不可构造、无 Pi 模型在环、结算/回执链条、浏览器套件、git 观察开销、Windows）。

## 11. Post-fix N6/N9（第五轮，最新快照）

### 11.1 快照与计数

| 文件 | sha256 |
|---|---|
| `devagent/src/runtime/git-delivery.ts` | `f6af11002b04ced04f0fe1b6b658f9b6b36116abb4170069eabebdcbc1153fd3` |
| `devagent/src/tools/completion-git.ts` | `54dcf07f…`（未变） |
| `devagent/test/git-commit-gate.test.ts` | `8770aeb4c690210499d385bef21b978211b4d16f4a5b8070dd838e8386dd68e8`（23 例） |
| `.agentdev/work/.../implementation.md` | `1556c27a94a59bfc34a13715d4ff0b7214bf526b5d89af8189dee46e6a85c7f8` |
| `docs/technicalnew/agents-and-tools.md` | `c2cbd622…`（未变） |

| 命令 | 结果 |
|---|---|
| `npx vitest run`（02:39） | **33 files / 368 tests passed** |
| `npx vitest run test/git-commit-gate.test.ts`（02:40） | **23 tests passed** |
| `npx tsc --noEmit`（02:39） | 无诊断，退出码 0 |

探针本轮 **39 个场景**（A–X 与 N1–N11），仍只 import 生产模块、不 import 测试文件。

### 11.2 三个原反例与新增变体

| 场景 | 观察到的缺项 | Task 状态 |
|---|---|---|
| **N6** 外层 `.gitignore: vendor/` 排除嵌套仓库（内层已提交） | `state: "ignored"`；1 条：`the nested repository vendor/lib is excluded by this project's .gitignore, so no commit here can carry what was reviewed; remove that rule or keep the nested delivery out of this project's delivery` | `active`（上一轮为 `completed`） |
| **N6b** 同上 + 内层文件未提交 | 2 条：ignored 缺项 + `inside nested repository vendor/lib: … not committed (a.txt)` | `active` |
| **N6c** 排除来自 `.git/info/exclude` 而非 `.gitignore` | 同样 `state: "ignored"` + 1 条缺项 | `active` |
| **N9** 两层嵌套：外层未记录 `vendor/a`，中间层已记录 `vendor/b` | 1 条：`the nested repository vendor/a is not recorded as committed in this project … git add -- vendor/a` | `active`；外层 `git add vendor/a` + commit 后 `gaps: []` → `completed` |
| **N9b** 两层嵌套：外层与中间层都未记录 | 2 条：`vendor/a` 未记录 + `vendor/a/vendor/b` 未记录（后者带 `inside` 前缀，`git add -- vendor/b`） | `active`；逐层记录后 `gaps: []` → `completed` |
| **N10** 三层嵌套，全部未记录 | 3 条：`vendor/a`、`vendor/a/vendor/b`、`vendor/a/vendor/b/vendor/c`；先记录 `b→c` 剩 2 条，再 `a→b` 剩 1 条，最后外层记录 `a` → 0 条 | `active` → `active` → `active` → `completed` |
| **N11** 已记录的 gitlink 同时命中 `.gitignore` | `state: "recorded"`，0 条缺项（`check-ignore` 跳过已跟踪路径，未误报 ignored） | `completed` |

N1–N5、N7/N7b、N8 与上一轮一致（内层脏/指针过期/多仓组合都阻断；N8 仍是两条：外层 dirty + inside unverifiable）。
A–H 回归无变化：A 提交后 `completed`；B/C 摘要门禁仍要求重新复核；D 暂存仍算未提交；E 前缀映射正常；F 无 git 正常收口；
G 只报未提交那条；H/H2 在 `git add -f` 或移出交付前保持 `active`。

### 11.3 明确结论：本轮未发现仍以 `completed` 收口的「复核已通过但未被提交」情形

- 上一轮点名的三个反例 **N6、N9、N9b 现在都被阻断**（`active`），且修复动作可执行：移除 ignore 规则/移出交付、
  `git add -- vendor/a`、逐层记录。
- 本轮所有 `completed` 的场景都属于**交付确实被项目（或项目记录的仓库）承载**：A（提交后）、F（无 git）、
  H（`git add -f` 后）、N3（指针提交后）、N4 step3、N7b（两个仓库都记录后）、N9（外层记录后）、
  N9b（逐层记录后）、N10（三层都记录后）、N11（已记录 gitlink）。J 只观察到门禁清空（未再调 end）；
  E 在提交后仍为 `active`，因为缺结算报告（与提交无关）。
- 在探针覆盖的形状内（普通文件脏/ignored/unverifiable、内嵌仓库未记录/内层脏/指针过期/gitdir 损坏、1–3 层嵌套、
  ignore 与 `.git/info/exclude`、已记录 gitlink + ignore 规则），**没有**「项目提交装不下、门禁却放行」的用例。
  未覆盖组合见 11.5，结论仅限已执行形状。

### 11.4 仍未修的小问题（不导致放行）

- **N5 措辞**：submodule 指针已在 HEAD、仅工作树脏时，`git status` 的 ` M vendor/lib` 仍被算作 `state: "unrecorded"`，
  于是多出一条「is not recorded as committed in this project」。事实是指针已记录，缺的是内层提交；该状态同时命中
  inside 的 dirty 缺项，故仍阻断（`active`）。建议按「指针 SHA 是否等于 HEAD 记录的 gitlink」区分，或把该句改成
  「内层有未提交改动，导致外层指针不能代表已复核内容」。
- **N8 过度阻断**：内层 `gitdir:` 指向不存在目录时，外层把它当普通目录报 `vendor/lib/a.txt` dirty，同时 inside 报
  unverifiable，两条都阻断；安全但重复。
- **内层 ignore 文案**：`commitGaps` 递归时忽略规则的句子仍写「this project's .gitignore」，在中间层命中时实际是
  中间仓库的规则；不影响阻断，措辞可再精确。

### 11.5 未验证

1. 中间层仓库自己的 `.gitignore` 排除下一层仓库（3 层 + ignore 组合）未构造；逻辑同 N6，但未实测。
2. 全局 `core.excludesFile` 排除嵌套仓库未实测（预期与 N6c 同）。
3. 4 层以上嵌套、嵌套仓库内再出现 submodule 的组合未测。
4. 第 8 节六项仍未验证（`deliveryState = null` 不可构造、无 Pi 模型在环、结算/回执链条、浏览器套件、git 观察开销、Windows）。

### 11.6 N5/N6 窄复核（快照 `704a3509…`，`npx vitest run` 33 files / 368 tests、gate 23、`tsc` 0）

- **N5 已修且措辞准确**：submodule 指针已提交、内层工作树脏 → `state: "recorded"`，只剩 1 条
  `inside nested repository vendor/lib: the reviewed delivery is not committed (a.txt)`，Task `active`；不再出现「未记录指针」的错误句子。
- **N6 未回归**：`.gitignore` / `.git/info/exclude` 排除嵌套仓库仍是 `state: "ignored"` 并单独阻断（内层脏时共 2 条），Task `active`；
  文案已改为「a .gitignore rule of the repository it sits in」。另确认 staged 指针、未跟踪内嵌仓库、无提交的内层仓库都判 `unrecorded`（N3/N1/N2/N4 step2），
  已提交指针判 `recorded`（N3 提交后、N4 step1/step3、N11）；A–H 与本轮其他场景无回归，N8 仍是 2 条阻断（外层不再报 dirty，改为 unrecorded + inside unverifiable）。
