# 测试责任规则独立审阅

日期：2026-10-04。审阅者：testing_responsibility_review；fork_turns=none，独立只读上下文。最终结论：Passed，无阻断发现。

从 AGENTS.md / docs/INDEX.md 加载本次正式 D-03/D-05、AC-14/18、五份变更提示词、G1/G4/I4，以及相关 G2/G3、S2、M2。没有读取作者聊天、作者自评工作记录、旧契约或旧代码；根 Agent 是唯一文档写者。

审阅确认：

- 单元/TDD 归开发，真实 API 集成和浏览器 E2E 归独立测试，开发自己的测试不能替代独立 Test（delivery:68～74；tester:7、27～29）。
- Red 必须是目标行为对应的真实失败，环境/语法错误不能充数；不回滚已有成果补造过程，重构按必要性（developer:31～33；I4:73）。
- 轻量和文档工作保持相称检查，不机械增加单元或额外测试阶段（delivery:59～62、70；tester:23）。
- tester 通过既有 bash 入口执行，临时验收产物仅限指定目录/授权环境；正式测试代码变化回 develop → Review → Test（G1:13、17；G4:160；tester:15、19～21、27）。
- 同候选 Review → Test、真实报告、必要环境 blocked/not_run 与既有程序核对边界一致（G2/G3:50、62、88～96、130～139；chief:41；I4:74）。

独立审阅另执行 git diff --check，结果通过。以上仅证明当前文档一致且可执行，不证明实际 SDK、模型、API 或浏览器产品验收已运行。
