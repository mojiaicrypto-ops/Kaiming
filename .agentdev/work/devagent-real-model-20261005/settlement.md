# Settlement Report · devagent-real-model-20261005

```yaml
settlement:
  task: devagent-real-model-20261005
  stable_facts:
    - "真实模型（deepseek-flash）下，移植版 question 工具的往返完整成立：模型调用工具 → 宿主适配器收到请求并作答 → 答复回到模型并体现在最终回复中（4/4 真实检查通过）"
    - "两条适配器结论经真实模型复核成立：交互开关是「是否绑定 UI 适配器」（mode 只作身份声明）；适配器必须实现为普通对象（对象展开会丢原型成员，实测 notify 变 undefined）"
    - "凭证经本地 gitignored 配置文件提供；密钥未进入代码、文档或提交"
  updated:
    - "docs/technicalnew/implementation-checks.md：PI-08 行写入两条已实测结论与回归检查要求（适配器必须为普通对象；交互开关是绑定适配器）"
    - "docs/technicalnew/validation.md：实施证据边界新增『真实模型下的宿主问答往返』一行，并列出仍未取证项"
    - "devagent/config/README.md、devagent/config/model.example.json：凭证配置说明与三种写法"
    - "devagent/test/model-config.test.ts：凭证配置解析的单元测试（含占位符、类型错误、缺文件、数组误用）"
    - ".agentdev/work/devagent-real-model-20261005/：本记录"
  proposed_for_confirmation:
    - "无新增契约变更；本次只把已实测结论写入既有检查条目"
  review_note:
    - "本次仅新增已由两轮独立审阅核实过的结论（普通对象要求 / 绑定适配器为开关）与其真实模型实测证据，未引入新的行为主张；未再单独安排设计审阅"
  indexes_updated:
    - none
  archived:
    - .agentdev/work/devagent-real-model-20261005/
  no_change:
    - "docs/productnew/**、其余 docs/technicalnew 契约"
    - "oldcode/、docs/old/、docs/architecturenew/、webui/（按 AGENTS.md 排除）"
  completion_gate: passed   # 真实模型 4/4 通过后写入文档；本记录与文档改动同次提交
```