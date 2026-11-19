# Implementation — P0-5

## 代码

- `src/runtime/plan-contract.ts`：新增 `VerificationProfile` 与 `declaredVerificationProfile`，只认独占一行的 `verification profile: visual|focused|broad`（中英文冒号、可带反引号、大小写不敏感、值后可带说明）；CommonMark 围栏按字符与长度配对（波浪线/反引号、长开短闭、异字符内层），4 空格或 tab 缩进视为代码；普通句子里的同名字样不匹配。HTML 注释块不在 Plan 格式内，明确不支持。
- `src/tools/delegation-tools.ts`：`DispatchEnvelopeFacts.verificationProfile`（undefined = 未求值，null = 已求值但没有声明）；`envelopeFacts` 对 implement Task 从 Plan 读取一次；派发给 developer/tester 时注入档位、该档允许的检查和“派发不得加码、冲突要报告”；无声明按 focused 文案。design/document 与其他角色不注入。宿主不解析派发命令。
- `src/tools/backlog-tools.ts`：工具描述补“规格引用是项目相对路径，可带 `#标题`；章节号不是引用”和 `add` 的适用范围（用户明确要求、确认的范围遗留/拆分、设计切片；顺手发现写报告）。存储与 op 行为未变。

## 契约与提示词

- `docs/productnew/modules/backlog-and-specs.md`：BL-02 的结算新增条件收窄为“本次范围内未完成、需要继续”；BL-13 的“一律记为待办”改为“影响已确认目标、需要继续的遗留问题”，顺手发现写报告。
- `docs/productnew/modules/delivery.md`：D-04 验证档写明是上限，Plan 验证配置和派发不得为 visual/focused 加全量；D-07 的结算核对行同步遗留语义。
- `docs/technicalnew/prompts/chief.md` v10：单 Task 单目标、不吸收无关未提交改动；派发不得扩档；结算只 close，add 仅限确认的范围遗留；交付完成后不提议立刻开新 Task。
- `docs/technicalnew/prompts/settler.md` v3：只关闭已交付项；add 仅限主管/用户确认的范围遗留。
- `docs/technicalnew/prompts/developer.md` v6、`tester.md` v5：验证档是上限，冲突按档执行并报告（tester 只在既有档位段补一句，不重复）。
- `docs/technicalnew/agents-and-tools.md`：G2 补引用格式与 add 范围；G4 写明 implement 派发的档位注入（值后可带说明）；G5 增加对应行为检查。
- 结算指引 `src/tools/guidance.ts`：settle 的 nextAction 从“record leftovers with backlog(op=add)”改为“side findings 写结算报告”，并有 `test/guidance.test.ts` 回归。
- 同步 `docs/productnew/acceptance.md` AC-23、`README.md`、`journeys.md` 与 `docs/technicalnew/storage-and-recovery.md` S6 的遗留语义。

## 验证

- `tsc --noEmit` exit 0。
- focused：`plan-contract 12/12`、`delegation 27/27`、`guidance 1/1`。
- 全量 68 文件 690/690；`check:prompts` 15/15。
- 独立 Review/Test 见 `review.md`、`test.md`。

## 偏差

- 没有在 `addItem` 里把不存在的 `specRefs` 改成硬拒绝：现行 `add` 只做语法校验，读回警告是既有契约；本次只修工具描述与提示词，避免改变 backlog 存储行为。
- 没有让宿主拒绝文字要求全量的派发：会误杀合法的 focused 命令，按 Plan 里的取舍保持提示词约束 + 成员冲突报告。
