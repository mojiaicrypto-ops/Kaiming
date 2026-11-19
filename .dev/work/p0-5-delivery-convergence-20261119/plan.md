# Plan: delivery convergence (P0-5)

verification profile: `broad` (shared dispatch contract + prompt contracts; full suite allowed with this reason)

## 背景

P0-4 切掉了主管无 Task 写文件的能力，但没有解决交付后“自我繁殖”的三个契约问题：

1. 结算规则要求把 leftover 写成 `backlog(op=add)`，与“用户明确要求才记待办”冲突；aisuangua 的 B-1～B-4 由此产生。
2. Plan 声明 `focused`，同一份 Plan 的验证配置和主管派发却要求全量单测/全站视觉；成员照做，扫出无关脏文件与历史页偏差。
3. 用户说“全部补做”时，主管把上一轮无关未提交文件并入同一个 Task。

工作树证据：`/Users/huyaohua/huyh/work/aisuangua/.dev/work/t-ec18b49b852e/plan.md`（头部 focused，验证配置“apps/web 全量单测”）与该 Task 的 developer 派发原文（`cd apps/web && npx vitest run`（全量）、packages/astro 全量、visual-check.mjs）。`developer.md:41` 在事故前已有 focused 规则，所以不是成员缺规则。

## 目标

- 结算只关闭本次交付的待办；不把顺手发现变成新待办。
- 验证档是上限：Plan 的验证配置和派发不得为 visual/focused 追加全量；成员发现冲突时按档执行并报告。
- 一个 Task 一个目标：无关未提交文件不进入本 Task 的范围或提交。
- 交付完成后停手，不主动提议立刻开新 Task。

## 范围

- `docs/productnew/modules/backlog-and-specs.md`（BL-02 新增条件、BL-11、BL-13 的遗留语义）
- `docs/productnew/modules/delivery.md`（D-04 验证档上限、D-05 冲突、D-07 结算遗留）
- `docs/technicalnew/prompts/chief.md`（v10：结算、单目标、交付即停、派发不扩档）
- `docs/technicalnew/prompts/settler.md`（v3：只关闭已交付项，不自动 add）
- `docs/technicalnew/prompts/developer.md`、`tester.md`（档位上限与冲突报告）
- `docs/technicalnew/agents-and-tools.md`（G2 backlog 引用格式与 add 语义、G4 信封注入、G5 检查）
- `kaiming/src/runtime/plan-contract.ts`（解析 Plan 声明的验证档）
- `kaiming/src/tools/delegation-tools.ts`（implement Task 派发 developer/tester 时注入档位与上限）
- `kaiming/src/tools/backlog-tools.ts`（工具描述补规格引用格式）
- 对应测试：`kaiming/test/plan-contract.test.ts`、`kaiming/test/delegation.test.ts`
- 验证记录与工作包记录

## 明确不在范围

- 不改 backlog 存储格式、不加新 op、不加 schema 迁移。
- 不以宿主文本审查拒绝派发命令（会误杀合法的 focused 命令）。
- 不禁止设计切片或用户明确要求的 `backlog(add)`。
- 不改 P0-4 的权限/门禁实现。

## 验收

1. `declaredVerificationProfile` 只识别独占一行的 `verification profile: visual|focused|broad`（中英文冒号、可带反引号），忽略代码块与普通行；无声明返回 undefined。单测覆盖四种情况。
2. implement Task 派发 developer/tester 时，宿主信封出现 `Verification profile (from the Plan): focused|visual|broad`；无声明出现 `none declared in the Plan; treat it as focused`。含“派发不能加码，冲突要报告”。design/document Task 或非 developer/tester 不出现。
3. 负向控制：派发信封不出现“run the full suite”作为 focused 的许可（只作为禁止项出现）；把 profile 改成 broad 后同一 fixture 的文案变为允许。
4. 产品与角色提示词：结算条款不再命令自动 `add` leftover；设定“本次范围内需要继续的遗留问题”才可 add；顺手发现写报告。三处（BL-02/BL-13/D-07、chief、settler）语义一致。
5. 提示词明确：验证档是上限，Plan 的验证配置和派发不得加码；成员冲突时按档执行并报告；一个 Task 一个目标；交付后不主动提议开新 Task。
6. `check:prompts` 通过（英文正文无中日韩字符）；`tsc --noEmit`；focused 测试与全量套件通过。
7. 独立 Review 与独立 Test：Test 至少一条变异（删掉信封注入或让解析恒返回 undefined）必须让新用例红；并覆盖“会议/文档 Task 不注入”的负向断言。

## 风险

- 产品文档原文“结算把遗留问题记为待办”是现行契约；本次是语义收窄，必须同时改 BL-02、BL-11/BL-13、D-07，避免留下相反旧句。
- 信封注入只解决“成员看得到档位”；不阻止主管在派发文字里写全量命令。真正约束靠提示词上限规则与 Review 检查，宿主不做自然语言审查。
- 提示词按进程缓存：重启后生效。
- 派发信封新增一行会改变所有 implement 派发的可见文本；测试断言用包含而非全等，避免脆断。

## 依据

- 用户 2026-11-19 决定：不切分，按本 Plan 全部开发。
- aisuangua Task `t-ec18b49b852e` 的 Plan、派发与结算记录（会话 `2026-11-18T13-33-11-450Z_01a1eedc...jsonl`）。
- 现行契约：BL-02/BL-11/BL-12/BL-13、D-04/D-05/D-07、G2/G4/G5。
