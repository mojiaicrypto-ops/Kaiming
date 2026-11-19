# P0-4 结算 · 主管只读 inspect 与 Review 后新增文件门禁

## 交付内容

- **权限**：chief 原生工具集 `read/grep/find/ls/inspect`；不再持有 `bash`/`write`/`edit`。`inspect` 只在 chief 分支注册，进入 `TOOL_UNIVERSE`，其他角色 denied；read/paused 保留它（不可写），仍挂起 `backlog`/`project`。写角色（designer/developer/tester/settler）的 bash 不变。
- **inspect**：`execFile('git', argv)`，无 shell；固定 `status/log/diff/show/rev-parse`；模型只能给 `op`、`limit`、校验过的 `rev`、项目相对 `path`；固定 `--no-pager -c core.fsmonitor=false`、`--no-ext-diff --no-textconv`、`GIT_OPTIONAL_LOCKS=0`，不运行仓库 helper、不写 index。
- **完成门禁**：`store.completionBlockers` 在摘要复查与 inherited 复查之后，用当前交付路径减去 Review 路径；按 Task 类型过滤（design → product/technical；代码绑定 → 代码路径；纯文档 → 非 `.dev`），排除 baseline 与知识入口，候选才查 gitignore。随后新增文件即缺项，`task(op=end)` 与事务内 `endTask` 同一检查。`completion-git` 仍只负责提交事实，避免重复提示。
- **提示词**：chief v9 写明无 shell/写入、inspect 检查、测试与结算提交归专业角色；`direct / no-interruption` 只授权一次连续 create → develop → review → test → settle → end，不授权跳过 Task 或独立复查。
- **契约文档**：`agents-and-tools.md` G1/G2/G3/G4 同步；`validation.md` 增加 P0-4 记录。

## 证据

- 独立 Review 两轮：PASS（首轮无阻断；三个非阻断观察已修正并复核）。
- 独立 Test：见 `test.md`（含七条已知坏输入与检查器自检）。
- 全量 67 文件 683/683；focused 107/107；`tsc --noEmit`；`check:prompts` 15/15。

## 生效与边界

- 提示词按进程缓存：workbench 重启后 chief v9 才进入模型系统提示；工具集与完成门禁随进程重启生效。
- 不引入跨回合 Git 账本；不回填历史脏工作区；inspect 不是 OS 沙箱，只保证主管没有写能力。
- 删除、测试运行、结算提交由保留 bash 的专业角色承担；`inspect` 无法表达的命令是委派理由，不是扩权理由。
