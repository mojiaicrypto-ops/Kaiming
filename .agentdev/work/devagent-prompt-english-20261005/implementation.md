# Implementation Summary · devagent-prompt-english-20261005

```yaml
implementation:
  task: devagent-prompt-english-20261005
  changed:
    - path: docs/technicalnew/prompts/*.md（九份）
      purpose: 注入模型的正文改为英文；小节标题按边界映射（Base rules / Judgment and expression / Shared rules / Role and goal / Role file map）
    - path: docs/technicalnew/agents-and-tools.md
      purpose: G4 正文提取边界改为英文标题；新增语言规则（注入文本英文、回复跟随用户语言）与检查入口
    - path: AGENTS.md
      purpose: 项目入口（会注入 Agent）改为英文
    - path: devagent/checks/prompt-language.ts（新增）
      purpose: 按 G4 边界抽取正文并断言：边界唯一可解析、正文足量且无中日韩字符、AGENTS.md 英文、提示词内 36 个链接全部可解析
    - path: devagent/package.json
      purpose: 新增 check:prompts 脚本
    - path: docs/technicalnew/validation.md
      purpose: 记录语言与提取证据
  behavior:
    - "实测 npm run check:prompts：11/11 通过；正文均为英文且无中日韩字符（base 5861 / specialists 3364 / chief 14882 / designer 16971 / developer 5215 / reviewer 4336 / tester 5069 / settler 5201 / investigator 3346 字符）"
    - "链接完整性：36 个链接目标全部可解析（标题锚点保持原样，因为目标文档仍为中文标题）"
    - "代码侧无回归：typecheck 0、47/47 测试、SDK 试验 47/47 无 FAIL"
  findings_for_implementation:
    - "只注入正文必须是英文；文件头（标题/状态说明/链接）不注入，因此链接锚点必须保持原样，否则链接会失效。检查脚本已把这条变成可执行断言"
    - "翻译子代理按角色分工并行完成（base+specialists / chief / designer+investigator / developer+reviewer / tester+settler），每份都要求 1:1 且不得增删规范内容"
  plan_deviation:
    - 我最初把验收标准写成「整份文件不得出现中日韩字符」，与「链接目标保持原样」冲突（目标文档仍为中文标题）。已按「仅注入正文为英文」修正，并把链接可解析性写入检查脚本
  open_items:
    - 代码注释与测试夹具中的少量中文不属于注入文本（不会被模型看到）；是否统一英文化待用户决定
  document_impact:
    - docs/technicalnew/agents-and-tools.md（G4）、validation.md 已更新；人类阅读的契约正文仍为中文
```