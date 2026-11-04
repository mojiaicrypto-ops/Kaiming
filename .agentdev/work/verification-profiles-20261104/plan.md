# 验证档：visual / focused / broad — 开发计划

工作类型：设计与正式文档（不选验证档；独立 Review + 结算，无 Test）。

## 问题

Task 工作流已有「轻量修改」和「开发自查按变更面收敛」的文字，但执行时仍容易把所有前端改动当标准工作，并把 `npm test` 全量套件当作 Test 证据。实际例子：`session-task-scope-20261103` 的 Plan 只要求 typecheck/build/浏览器，Test 却跑了整个 webapp 92 用例；`ui-design.md` 的 U8 仍把 `npm test` 全绿写成 UI 门禁。

## 目标

把「独立 Test 阶段」和「全量套件」拆开。主管在总体 Plan 中显式选择验证档，后续开发、Review、Test 按档执行；全量只用于 broad 或发布/跨模块门禁。

## 三档

- `visual`：单一文案、纯样式、颜色/间距/字体/图标、确定展示，不改变事件、状态、请求或数据。简短计划 → 开发修改 → 独立 Review（变更、引用、必要截图/构建）→ 结算；`requiresTest=false`，不建 Test 阶段，不跑全量。
- `focused`：改变一个局部行为、函数、接口或页面交互（包括 pending、队列、按钮触发操作）。开发跑变更面 TDD/定向测试和一条聚焦浏览器路径；Review 后 Tester 只跑本次验收入口和相关回归；`requiresTest=true`，不跑全量。
- `broad`：共享契约、数据迁移、权限/状态机、公共基础层或已知高风险改动。允许全量套件和全套/跨模块浏览器；Plan 写明原因和命令；`requiresTest=true`。

发布/集成节点始终跑全量，不属于单个 Task 的默认验证。

## 落点

- `docs/productnew/modules/delivery.md` D-04/D-05：定义三档、默认 focused、Plan 必填、命令与未运行范围。
- `docs/productnew/acceptance.md` AC-49：visual/focused/broad 的可观察差异。
- `docs/technicalnew/prompts/chief.md`：创建 Task 时选档、写命令、设置 `requiresTest`、派发时传档。
- `docs/technicalnew/prompts/developer.md`：按档自查；visual 不做无行为价值的单测。
- `docs/technicalnew/prompts/tester.md`：按档验证；非 broad 不跑全量。
- `docs/technicalnew/ui-design.md` U8：标记为发布/跨模块门禁，单 Task 不默认套用。
- `docs/technicalnew/implementation-checks.md` I4、`AGENTS.md` 项目规则、`docs/technicalnew/validation.md`。

## 非目标

- 不新增 Task 状态、数据库字段或程序化门禁；先复用 Plan、`requiresTest` 和人工判断。
- 不删除标准代码工作的独立 Test。
- 不改变具体测试命令或测试实现。

## 验证

- 文档与提示词装配一致性；`test/context.test.ts`、两端 `tsc --noEmit`。
- 独立 Review 检查档位边界、默认 focused、visual 与 broad 的可执行性，以及是否留下“跑全量”的默认口子。

## 风险

- visual 可能改到共享 CSS/token；如果影响多个页面或公共基础层，按 broad，而不是 visual。
- 前端行为仍由 focused 的独立 Test 覆盖；不能把“少跑全量”误读成“跳过验收”。
