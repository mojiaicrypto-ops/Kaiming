# Independent Test — P0-4

Date: 2026-11-19. Separate agent context. All runs in full `/tmp` copies (`/tmp/p04-base`, one per mutation); workspace untouched, port 4173 untouched. Base copy was byte-identical to the workspace.

## Verdict: passed

| 验收 | 结果 | 证据 |
|---|---|---|
| A. chief 无 shell/写入；inspect 仅主管且 hold 保留 | pass | 7 角色 × 3 Task 类型 × 2 hold 的 `toolSetFor` argv；chief 所有组合 inspect=true、bash/write/edit=false；其余 6 角色 inspect 缺席且 denied；运行中/暂停的真实 active 集合含 inspect、不含 bash |
| B. inspect 结构只读 | pass | 固定 argv；7 组坏参数在 git 之前被拒（PATH git shim 自检：有效 status 才触发 shim）；真实仓库 status/HEAD/index 不变；仓库配置的 external diff/textconv/fsmonitor helper 均未执行（plain `git status` 会执行 fsmonitor，工具前缀抑制）；`;`/`$()`/反引号作为 path 不执行；非仓库报错 |
| C. Review 后新增文件门禁 | pass | 直接 Store：新增 `late.ts` 后 `taskCompletionGaps` 报告，`endTask.ok=false`；删除后 `ok=true`；无 Git 项目同样生效；modified/deleted reviewed 由摘要缺项；unchanged inherited 不误报、changed inherited 走 inherited 缺项；ignored 构建产物不误报；design 只报 `.dev/product|technical`；根文档不误报 |
| D. 无 schema/backlog 变更，文档与代码一致 | pass | store diff 仅 imports + completionBlockers；无迁移/新 op；chief v9、agents-and-tools、validation 与代码一致；`check:prompts` 15/15 |

## 计数

- focused 5 文件 107/107；全量 67 文件 683/683；`tsc --noEmit` exit 0；`check:prompts` 15/15。
- 端到端探针（作者侧补充，tester 已独立复现）：无 Git 仓库 Review `a.ts` 后新增 `late.ts`，`taskCompletionGaps` 返回 `files appeared after the last passed review (late.ts)`，删除后消失。

## 变异（各自独立副本，按预期变红）

| # | 变异 | 结果 |
|---|---|---|
| 1 | chief 原生集合加回 `bash` | `tool-sets + runtime` 6 failed（`not.toContain('bash')`） |
| 2 | `validRev` 接受前导 `-` | inspect 2 failed；`--output=/tmp/evil` 被 git 接受 |
| 3 | 去掉 `-c core.fsmonitor=false` | hostile helper 测试 1 failed，marker 被创建 |
| 4 | `newReviewableDeliveryPaths` 直接返回 `[]` | report 3 failed（late code、settlement docs、design） |
| 5 | 去掉 baseline 排除 | inherited 用例 1 failed（inherited.ts 被当新文件） |
| 6 | 去掉候选 gitignore 过滤 | ignored 构建产物用例 1 failed |
| 7 | 把 docs 当代码交付（`if (binding.codeBound) return true`） | settlement docs 用例 1 failed |

## 生效

提示词按进程缓存：工具集与门禁随重启生效，chief v9 正文也在 workbench 重启后才注入。
