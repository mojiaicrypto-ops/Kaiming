# Independent Test · 验证档结构化

日期：2026-11-20
验证档：broad
对象：`.dev/work/verification-profile-20261120/plan.md` 与工作树改动。
结论：**passed**。

## 执行环境

- 主树只读运行：`kaiming/` 的 typecheck、全量 vitest、check:prompts；前后 `git status --porcelain` 对比，`kaiming/` 条目无变化。
- 真实入口：`/tmp/vp-main`（`rsync` 复制的 `kaiming/`，node_modules 软链）内用临时 spec 驱动真实 `task` 域工具 + 临时 Store/project；结束后删除。
- 负向控制：`/tmp/vp-neg` 第二份副本，删掉旧 Task 的 Plan-only 守卫后重跑对应用例，确认变红；产品树未改。副本已删除。

## 真实入口观察

| 场景 | 观察 |
|---|---|
| implement 不带 `verificationProfile` | `isError=true`，`missing=verificationProfile` |
| visual + requiresTest=true | 拒绝，文本 `visual requires requiresTest=false` |
| focused + requiresTest=false | 拒绝，`details.requiresTest=false` |
| Plan `**broad**` 对参数 focused | 拒绝，`declared=broad`、`verificationProfile=focused` |
| 参数 broad + Plan `**broad**` | 创建成功，`op=get` 返回 `task.verificationProfile=broad` |
| 旧行 + 仅 Plan 新增 `**broad**` | 拒绝 `missing=verificationProfile`，行保持 null |
| 旧行 + profile/requiresTest/Plan 同步 | 接受，库与 `op=get` 均为 broad/true |
| focused 行 update 去掉 Test | 拒绝，`requiresTest` 保持 true |
| 派发 focused | 信封含 `(from the Task): focused`、验收行档位上限、`does not widen it; run only the profile's checks…`；无全量指令 |
| 旧行 profile=null + Plan `**broad**` | 信封 `(from the Plan; the Task predates the field): broad` |
| v20→v21 | 删列并 `user_version=20` 后重开：版本 21，旧行 null 且数据保留，新行 round-trip |
| 解析器 | `**`/`__`/`*`/反引号接受；围栏与 4 空格缩进忽略；`broader` 不匹配 |

验收文本原样下发与档位上限句同时存在（宿主不审查自然语言）：按设计，不记为缺陷。

## 负向控制

在 `/tmp/vp-neg` 删除 `kaiming/src/tools/task-tools.ts` 的旧行 Plan-only 拒绝分支后运行：

```
FAIL test/task-tools.test.ts > verification profile contract > refuses to change a legacy Task without stating its profile
AssertionError: expected false to be true
 ❯ test/task-tools.test.ts:800:30
   expect(planOnly.isError).toBe(true);
```

用例确实依赖该守卫，不是周围机制的顺带通过。

## 主树检查

- `npm run typecheck`：通过。
- `npx vitest run`：68 文件 / 697 通过。
- `npm run check:prompts`：15/15。

## 未覆盖

- 真实 Pi 模型会话与 HTTP read-method 线上形态；读模型暴露只由仓库既有全量测试覆盖。
- v20 迁移用“当前库删列 + 回退版本号”模拟，未运行旧二进制。
- 提示词语义（最小入口、只读 Tester 负证）只经 check:prompts 的装配/语言检查，未做模型行为验证。
