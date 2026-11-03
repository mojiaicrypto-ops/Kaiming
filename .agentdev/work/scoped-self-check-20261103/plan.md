# 开发自查收敛与独立 Test 范围 — 计划

## 现象

develop 每个改动都跑全量测试，页面改动还跑整套 E2E；Review 和 Tester 之后仍会独立检查，造成重复、无信息量的耗时。

## 决定

- 开发自查围绕变更面：后端只跑改动函数/接口及直接契约的定向单元/集成测试；页面改动只跑一条聚焦真实浏览器路径。
- 默认不跑全量套件或整套 E2E。
- 只有共享契约、数据迁移、权限/状态机、公共层或已知高风险改动才扩大范围，并在报告中说明原因。
- Review 后独立 Test 仍执行，按本次验收与相关回归收敛，不因开发自查减少而省略。
- 未运行范围如实报告，不能用“开发自查通过”替代独立验收。

## 落点

- `docs/productnew/modules/delivery.md` D-05
- `docs/productnew/acceptance.md` AC-47
- `AGENTS.md`
- `docs/technicalnew/prompts/{developer,tester,chief}.md`
- `docs/technicalnew/implementation-checks.md` I4
- `docs/technicalnew/validation.md`

## 非目标

- 不删除独立 Test 或降低验收标准。
- 不把“减少测试”变成跳过关键链路；高风险改动仍扩大范围。
- 不新增程序阶段或自然语言测试门禁；由角色提示词与 Review/Test 执行。

## 验证

`test/context.test.ts`、`tsc --noEmit` 和文档一致性检查；真实模型中“定向自查”的耗时/漏检率尚未执行，AC-47 保留。
