# 结算文档不应触发重审重测 — 修复计划

## 现象

Review passed → 结算更新 `docs/**` 并提交 → `task(op=end)` 重算 Review 的 `deliveryState`，发现摘要变化，要求重新 Review/Test。代码未改，补测仍要跑完整测试/浏览器；M4/M5/M6/M8 均出现。

## 根因

`agent_report` 给 Review 记录的是项目内所有被观察文件的摘要（只排除 `.git`、`node_modules`、`.dev`、知识入口和 Git 忽略文件）。结算按 D-07 会写 `docs/**`，这些路径也在摘要里；end 因此认为被复核交付已变化。Test 沿用 Review 的路径清单，进一步产生无信息量的重测。

## 方案

1. Review 快照包含代码路径时，交付绑定只保留非文档路径。
2. 文档路径定义为 `docs/**` 与根目录 Markdown；它们被视为结算输出。
3. 如果快照没有任何代码路径（文档专用交付），保留完整文档路径，避免文档任务失去复核依据。
4. Test 继续沿用 Review 的路径清单，因此也只看代码。
5. 代码文件变化仍使 Review/Test 失效，end 继续拒绝；不改变 Git 提交闸。

## 验证

- `test/report.test.ts`：结算文档改动后、代码不变，end 成功；文档专用交付仍绑定 `docs/spec.md`。
- 服务端全量 49 文件 504 用例、`tsc --noEmit` 通过。

## 边界

- 只对新的 Review 结果生效；旧 Review 的 `deliveryState` 仍是旧路径清单，需要一次新 Review 才能获得代码范围绑定。
- 不自动回填历史结果，不把代码改动当成文档改动放过。
