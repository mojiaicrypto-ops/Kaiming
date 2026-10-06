# Test Report · devagent-p3-tools-20261005（切片 P3-a 上下文装配）

```yaml
test:
  task: devagent-p3-tools-20261005
  slice: P3-a 上下文装配
  environment:
    runtime: node v24.8.0 / vitest 3.2.7；@earendil-works/pi-coding-agent 1.0.0；集成测试用本地 stub 端点
  runs:
    - command: cd devagent && npx tsc --noEmit
      result: passed
      exit_code: 0
      evidence: "无输出"
    - command: cd devagent && npm test
      result: passed
      exit_code: 0
      evidence: "5 个测试文件、56 项通过（runtime 新增 3 项装配用例；context.test.ts 新增 6 项切片与上下文用例）"
    - command: cd devagent && npm run check:prompts
      result: passed
      exit_code: 0
      evidence: "15/15：九份注入正文英文且足量、装配组合正确、边界标题字面量各恰好一次、抽取结果的起点即文档化字面量、边界缺失/起点重复/终点重复均被拒、AGENTS.md 英文、39 个链接可解析"
    - command: cd devagent && npm run spikes
      result: passed
      exit_code: 0
      evidence: "47/47，0 FAIL"
    - command: cd devagent && node checks/runner-real-model.ts
      result: passed
      exit_code: 0
      evidence: "4/4：真实模型下完整链路（含角色注入）完成并记录边界"
  key_evidence:
    - "chief 会话的 systemPrompt 含 base 正文前 120 字符与 chief 正文前 120 字符，且仍含 Pi 原生块（<cwd>），长度大于注入文本长度 → 是追加不是替换"
    - "reviewer 会话的 systemPrompt 含共同规则与 reviewer 正文，且不含 chief 正文 → 只注入当前角色"
    - "未知 roleId（nobody）→ blocked_role(INVALID_ARGUMENT)，输入保持 queued，未创建 Pi 实例"
    - "边界提取复用产品模块：check:prompts 直接调用 loadPromptBodies/sliceInjectedBody，断言其组合结果"
    - "边界字面量独立校验：`## Base rules`/`## Judgment and expression`/`## Shared rules`/`## Role file map`/`## Role and goal` 在各自文件中恰好出现一次（不依赖抽取器）"
    - "切片负例：缺起点、起点重复、终点重复三种都抛错（单测与 check:prompts 各覆盖一遍）"
    - "单轮上下文纯函数：完整分支含输入/任务/阶段/计划/授权/依据/依赖结果；空分支全部为 none"
  not_covered:
    - area: "单轮上下文（Task/Plan/授权/依据）的实际投递"
      reason: "依赖 P3-c/d 的 Task 与 Plan；当前只有纯函数与断言"
      disposition: pending
    - area: "角色工具集裁剪（P3-b）、四个核心工具（P3-c）、委派等待（P3-d）、报告与需求工具（P3-e）"
      reason: "本切片只做装配"
      disposition: pending
    - area: "英文提示词下的真实模型行为"
      reason: "属 I4 场景，需要按场景表逐项跑真实模型"
      disposition: pending
  result: passed
```