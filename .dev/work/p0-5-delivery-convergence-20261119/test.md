# Independent Test — P0-5

Date: 2026-11-19. Separate agent context, full `/tmp` copies; workspace untouched, port 4173 untouched.

## Verdict: passed

| 验收 | 结果 | 证据 |
|---|---|---|
| A. 解析 Plan 档位 | pass | 中英文冒号、反引号、大小写、CRLF、值后说明均识别；散文、列表、引用、反引号/波浪线围栏、`exhaustive`、`broader` 均拒绝；无声明 undefined。真实 Plan：aisuangua 事故 Plan → focused，本 P0-5 Plan → broad |
| B. 派发信封 | pass | 真实 `task(op=dispatch)`：focused 的 developer 输入含档位、“no full suite”“cannot widen”；无声明 → “none declared … treat it as focused”；broad → “allowed with the reason”；真实 tester 派发含 tester 专用文案；reviewer、document/design、planRef 为空、未求值事实均不出现；续办重复档位且不矛盾 |
| C. 结算与文档 | pass | settle Task 的 `guidanceFor` 只有 close，无 `backlog(op=add)`/“record leftovers”，写明 side findings 进报告；规范文档无残留的“无条件把 leftover 记为待办”；`backlog-tools.ts` 仅两条描述；`resolveRef` 仍接受任意项目相对路径 |
| D. 范围与检查 | pass | 无 schema/迁移/新 op；改动仅 4 个源码文件与测试/文档。全量 68 文件 690/690，`tsc` exit 0，`check:prompts` 15/15 |

## 变异（各自独立副本，按预期变红）

| # | 变异 | 结果 |
|---|---|---|
| 1 | 删除信封注入 | delegation 3 failed（默认行、声明行、负向用例） |
| 2 | 去掉 `workKind === 'implement'` | document 负向断言 failed |
| 3 | 去掉 developer/tester 角色限制 | reviewer 负向断言 failed |
| 4 | 解析恒为 undefined | plan-contract + 派发链路 2 failed |
| 5 | 无声明回退改成 broad | 默认文案断言 failed |
| 6 | guidance 恢复 “record leftovers with backlog(op=add)” | guidance 1 failed |
| 7 | 负向控制：`verification profile: broader`、列表行 | 均 undefined；正样本 focused → focused |

## F1 与修正

首轮发现围栏只识别反引号，且简单 toggle 会把“长开短闭”“异字符内层”“带文字的闭栏”和 4 空格缩进误当声明。已改为 CommonMark 式状态：记录开启栏的字符与长度，只有同字符、长度不短于开启栏、且后面只有空白的行才关闭；开启栏允许 info string；4 空格/tab 缩进视为代码；HTML 注释块明确不属于 Plan 格式。

新增测试覆盖 4 反引号开/3 反引号内层、波浪线与反引号互套、` ``` note` 不关闭、4 空格缩进、正常关闭后的声明。Tester 用 37 例矩阵复核：全部围栏长度/字符/info string/CRLF/缩进与两份真实 Plan 正确，focused 40/40；最终全量 690/690。

## 已知非缺陷

- 全量套件在负载下偶发 `git-commit-gate` 5s 超时（tester 与 reviewer 各见一次）；该文件单独 30/30 两次通过，改动未触及 git 代码，安静机器复跑 690/690。改动前基线副本同样有 load-timing 波动。
- 提示词按进程缓存：重启 workbench 后 v10/v3/v6/v5 与信封新行才生效。
