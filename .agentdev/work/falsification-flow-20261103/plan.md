# 测试与审计的反证流程 — 计划

## 问题

检查器的期望值如果来自实现输出或单一夹具，它只能发现“实现偏离这条假设”，发现不了假设本身错误；全绿测试无法证明检查器会红。现有 D-05、Tester/Reviewer/Chief 提示词都没有强制负向控制或检查器自检。

## 决定

1. 期望值必须来自正式验收、独立事实或不变量；变化数据用关系断言，不绑定某一份样例的字面值。
2. 标准代码的独立 Test 至少包含一个负向控制：已知错误输入、错误期望或实现变异必须按预期失败。
3. 检查器/审计脚本必须用已知坏样本自检；坏样本通过则 Test 不通过。
4. Reviewer 检查测试 oracle、负向控制和自检证据，缺项为 blocking。
5. Chief 在组织 Review/Test 时要求反证证据，不能只看 N/N 全绿。
6. 产品验收增加 AC-46，覆盖“硬期望 + 坏样本 + 不同正确数据”。

## 落点

- `docs/productnew/modules/delivery.md` D-05
- `docs/productnew/acceptance.md` AC-46
- `docs/technicalnew/agents-and-tools.md` report/check 规则
- `docs/technicalnew/prompts/{tester,reviewer,chief}.md`
- `docs/technicalnew/validation.md`

## 非目标

- 不新增阶段、状态或程序级自然语言门禁；程序无法判断 oracle 质量，由 Review/Test 和主管判断。
- 不要求文档/纯样式工作伪造测试。
- 不自动修改历史报告或验收。

## 验证

`test/context.test.ts` 6 用例、`tsc --noEmit` 通过；本次是流程/提示词改动，没有业务代码变更。真实模型下“坏样本通过必须阻断”的端到端行为尚未执行，保留为未覆盖。
