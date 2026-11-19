# P0-4 实施记录

## 第一层：主管无 shell

- `runtime/tool-sets.ts`：chief 原生集合由 `read/grep/find/ls/bash` 改为 `read/grep/find/ls/inspect`；`inspect` 进入 TOOL_UNIVERSE，因此其他角色的 denied 自动包含它。read/paused 只裁剪 write/edit/bash，inspect 保留。
- `tools/inspect-tool.ts`：`execFile('git', argv)`，无 shell。固定子命令 `status/log/diff/show/rev-parse`；模型只提供 `op`、`limit(1–50)`、校验过的 `rev`、项目相对 `path`，其他键拒绝。固定加 `--no-pager -c core.fsmonitor=false`，diff/show 加 `--no-ext-diff --no-textconv`，环境 `GIT_OPTIONAL_LOCKS=0`/`GIT_PAGER=cat`/`GIT_TERMINAL_PROMPT=0`；超时 10s、输出截断 20k。
- `runtime/runner.ts`：inspect 只在 chief 分支注册（与 task/backlog/project 同组），经 `asToolDefinitions` 接入。
- 结算提交：`prompts/chief.md` v9 改为由 settler 提交；`inspect` 无法执行测试或写文件。

## 第三层：免打扰语义

- `prompts/chief.md` 新增一段：`direct / no-interruption` 只授权一次连续跑完 create → develop → review → test → settle → end，不授权跳过 Task、自己写文件或跳过独立 Review/Test/Settlement。
- 同段说明主管无 shell/write，检查用 inspect 与 read/grep/find/ls，测试运行交给专业角色。

## 第二层收敛：Review 后新增文件

- `runtime/deliverable.ts`：
  - 拆出 `projectFilePaths`（只走目录，不做 hash、不查 ignore）与 `deliveryPaths`（原有 snapshot 的路径观察 + ignore 过滤）；`designDeliveryPaths` 复用。
  - 新增 `newReviewableDeliveryPaths(cwd, paths, reviewed, binding, baseline)`：取当前路径减去 reviewed，按 Task 类型过滤，排除 baseline 已有路径；仅对候选执行 `git check-ignore`（design 不查），无新文件时只付目录遍历。
- `store.completionBlockers`：在既有“reviewed 路径摘要变化 / inherited 路径变化”之后，观察当前交付路径并报告未被 Review 覆盖的可评审新文件；`endTask` 的事务内重查同样经过这里。观察失败（git 无法判定 ignored）作为缺项阻断。
- 单点实现：`completion-git.ts` 仍只查提交事实；`endOp` 与 guidance 同时组合两者，提示不重复。

## 代码外验证

- 全量 `npm test` 67 文件 682/682；`tsc --noEmit`；`check:prompts` 15/15。
- 独立 Review 与独立 Test 见 review.md / test.md。
