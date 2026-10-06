# Test Report · devagent-prompt-english-20261005

```yaml
test:
  task: devagent-prompt-english-20261005
  environment:
    runtime: node v24.8.0
    scope: 文档与检查脚本；不涉及运行时行为改动
  runs:
    - command: cd devagent && node checks/prompt-language.ts
      result: passed
      exit_code: 0
      evidence: "11/11：九份注入正文边界唯一可解析、正文足量且无中日韩字符（base 5861 / specialists 3364 / chief 14882 / designer 16971 / developer 5215 / reviewer 4336 / tester 5069 / settler 5201 / investigator 3346 字符）；AGENTS.md 英文（1589 字符）；提示词内 36 个链接全部可解析"
    - command: cd devagent && npx tsc --noEmit
      result: passed
      exit_code: 0
      evidence: "无输出（含新增 checks/prompt-language.ts）"
    - command: cd devagent && npm test
      result: passed
      exit_code: 0
      evidence: "4 个测试文件、47 项通过"
    - command: cd devagent && npm run spikes
      result: passed
      exit_code: 0
      evidence: "47/47 断言，0 FAIL"
  key_evidence:
    - "边界映射：`## 基础规则`→`## Base rules`、`## 判断与表达`→`## Judgment and expression`、`## 共同规则`→`## Shared rules`、`## 角色与目标`→`## Role and goal`、`## 角色文件映射`→`## Role file map`；检查按这些锚点抽取"
    - "注入切片无中日韩字符：九份逐一断言（cjk=none）"
    - "头部元数据不注入：标题、状态说明与链接保留原样；36 个链接目标全部可解析（含中文标题锚点）"
    - "AGENTS.md（项目入口，会注入 Agent）已英文化"
  not_covered:
    - area: "英文提示词下的真实模型行为（是否仍遵守同一套规则）"
      reason: "语言改动不改规范含义，但模型对英文指令的遵守需要在 I4 场景表里用真实模型逐项验证"
      disposition: pending
    - area: "面向人类阅读的契约正文（R/M/S/G 与产品文档）保持中文"
      reason: "用户要求的是提示词与系统级语言；人类文档不在范围内，若需全英文化由用户另外指示"
      disposition: pending
    - area: "代码注释与测试夹具中的少量中文"
      reason: "不属于注入模型的内容；是否统一由用户决定"
      disposition: pending
  result: passed
```