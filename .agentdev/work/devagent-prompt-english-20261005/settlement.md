# Settlement Report · devagent-prompt-english-20261005

```yaml
settlement:
  task: devagent-prompt-english-20261005
  stable_facts:
    - "进入模型的系统级文本一律英文：九份角色提示词正文与项目入口 AGENTS.md；模型对用户的自然语言回复跟随用户输入语言"
    - "装配边界改为英文小节：`## Base rules`（至文件末尾，含 `## Judgment and expression`）、`## Shared rules`（至 `## Role file map` 之前）、`## Role and goal`（至文件末尾）"
    - "只注入正文受语言约束；标题/状态说明/链接属人类元数据，链接锚点保持原样，人体阅读的契约正文仍为中文"
    - "可执行检查（npm run check:prompts）：按边界抽取并断言边界唯一可解析、正文足量且无中日韩字符（含谚文/部首/兼容表意/CJK 扩展）、AGENTS.md 英文、39 个链接目标全部可解析"
    - "证据：check:prompts 11/11；typecheck 0；单元/集成测试 50/50；SDK 试验 47/47 无 FAIL"
  updated:
    - "docs/technicalnew/prompts/*.md（九份，注入正文英文）"
    - "docs/technicalnew/agents-and-tools.md（G4 边界与语言规则）"
    - "AGENTS.md（项目入口英文）"
    - "devagent/checks/prompt-language.ts + npm run check:prompts（新增检查）"
    - "docs/technicalnew/validation.md（语言与提取证据）"
    - ".agentdev/work/devagent-prompt-english-20261005/：plan/implementation/test/review/settlement"
  proposed_for_confirmation:
    - "人类阅读的契约正文（R/M/S/G 与 docs/productnew）保持中文；如需全英文化请另行指示"
    - "devagent 源码注释与测试夹具中仍有少量中文（不属于注入模型的内容）；是否统一英文化请指示"
  indexes_updated:
    - none
  archived:
    - .agentdev/work/devagent-prompt-english-20261005/
  no_change:
    - "docs/productnew/**、其余 docs/technicalnew 契约正文（未改语言）"
    - "oldcode/、docs/old/、docs/architecturenew/、webui/（按 AGENTS.md 排除）"
  completion_gate: passed   # 独立审阅 passed；三项 non-blocking 已修复并复跑通过；本记录随本次提交
```