# Plan · devagent-prompt-english-20261005

状态：Approved（用户指令：项目内提示词与所有面向 AI 的系统级语言默认用英文；AI 回复跟随用户输入语言）
依据：角色与上下文装配（G4）、七角色提示词（docs/technicalnew/prompts/*）、验证记录。

```yaml
plan:
  task: devagent-prompt-english-20261005
  goal: >
    把进入模型上下文的系统级文本改为英文：九份角色提示词、项目入口 AGENTS.md，
    以及它们的装配边界描述；AI 的自然语言回复仍按用户输入语言。
  in_scope:
    - docs/technicalnew/prompts/{base,specialists,chief,designer,developer,reviewer,tester,settler,investigator}.md 全文英文
    - agents-and-tools.md G4：正文提取边界改为英文小节标题；补充「注入正文为英文、回复跟随用户语言」
    - 仓库根 AGENTS.md（会作为项目入口注入 Agent）改为英文
    - 可运行检查：按 G4 边界抽取各角色正文并断言无中日韩字符、边界可解析、角色正文齐全
    - validation.md 证据更新
  out_of_scope:
    - 非注入的人类阅读契约（R/M/S/G 正文、产品文档）保持中文
    - 不改任何规范含义；只改语言（1:1 忠实翻译）
  steps:
    - id: L1
      change: 九份提示词英文翻译（结构、小节顺序、链接、规范内容 1:1）
      verify: [checks/prompt-language.ts 断言无 CJK、边界可解析]
    - id: L2
      change: G4 边界与说明更新；AGENTS.md 英文化
      verify: [边界标题与实际文件一致；抽取器按新边界取到正文]
    - id: L3
      change: validation.md 记录本次语言与提取证据
      verify: [记录与检查输出一致]
  review_focus:
    - 翻译是否丢改规范含义（尤其禁止项、降级路径、报告字段）
    - 抽取边界是否仍与文件一致
    - 是否残留中文示例文本
  test_plan:
    - npm run check:prompts（新增）：边界解析 + 无 CJK + 角色齐全
    - npm run typecheck / npm test / npm run spikes 不回归
  approval: approved-by-user-instruction
```