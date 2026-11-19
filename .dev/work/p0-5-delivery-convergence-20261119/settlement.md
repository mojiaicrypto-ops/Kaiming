# P0-5 结算 · 交付收敛

## 交付内容

- **结算遗留**：BL-02/BL-13、AC-23、S6、README、journeys、D-07、chief v10、settler v3 与宿主 `guidance.ts` 统一为：结算只关闭本次交付的待办；新条目仅限用户明确要求、确认的范围遗留/拆分和设计切片；开发/评审/测试的顺手发现写结算报告，不建待办。交付完成后不提议立刻开新 Task。
- **验证档上限**：D-04 写明档位是上限，Plan 验证配置和派发不得为 visual/focused 加全量；developer v6、tester v5 明确冲突时按档执行并报告。宿主从 Plan 读取独占一行的 `verification profile`（值后可带说明，代码块内不读），implement Task 派发给 developer/tester 时把档位、允许范围与“不得加码”写入信封；无声明按 focused。
- **单 Task 单目标**：chief v10 禁止把无关未提交改动吸收进范围或结算提交。
- **backlog 工具描述**：规格引用是项目相对路径（可带 `#标题`），章节号不是引用；`add` 的范围与上面一致。存储与 op 行为未改。
- 验证记录与工作包记录已更新。

## 证据

- 独立 Review：首轮 NEEDS_FIX（settle 指引与四处规范文档仍命令把 leftover 记为待办），修正后 PASS；最终代码再复核 PASS（围栏配对、缩进代码、负向用例）。
- 独立 Test：首轮 passed，并发现围栏配对/缩进的代码块误报；修正后用 37 例矩阵重测 pass，七条变异按预期变红。
- 计数：focused 40/40；全量 68 文件 690/690；`tsc` exit 0；`check:prompts` 15/15。详见 `test.md` 与 `validation.md`。

## 生效与边界

- 提示词按进程缓存：workbench 重启后 chief v10 / settler v3 / developer v6 / tester v5 与信封新行才生效。
- 宿主不解析派发命令文本，不阻止主管在文字里写全量；约束由档位上限、成员冲突报告和 Review 执行。
- `backlog(add)` 仍允许设计切片与用户明确要求；不改变待办文件格式。
- 不引入 schema 迁移或新的 Task 状态。
