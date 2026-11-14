# Settlement report — worker-idle-scan-20261114

Date: 2026-11-14 · workKind: implement · profile: broad · Type: code delivery

## 实际改变与验收

三项空闲成本优化，全部在 Plan 授权范围内：

1. **worker 空闲过滤**：`Store.listRunnableSessionIds()`（queued/processing/interrupted 去重集合）；`WorkbenchWorker.run` 每轮只探测该集合。空载时不再随 session 表线性探测；busy/blocked/claimed 结果面与唤醒时延（notify + 250ms 兜底）保持不变。
2. **可用性快照**：`PiRuntimeFactory.isAvailable` 答内存快照，models.json/auth.json/models-store.json 的 (mtimeMs,size) 戳变化才全量刷新；`reload()` 保留（保存路径兜底）并按评审修复取戳时序（刷新前取戳、之后赋值）。
3. **语句缓存**：Store 全部查询走 `stmt()`（按最终 SQL 文本键控，close 清空）；S3 认领算法逐字未变（评审 diff 确认）。

验收逐项满足：空闲轮不探测无输入/纯终态会话（负向控制测试）；R5（文件变化下一次 isAvailable 即反映，monkey-patch 证明快照路径零全量刷新；用户决定 "auto"）；语句重绑定回归；A/B 基准空载 148%→≈0%。

## 验证

- 开发自查：`tsc --noEmit` 通过；全量 vitest **65 文件 / 616 用例通过**；red→green（旧实现 + 新测试 6 处红 → 新实现全绿，记录于 evidence）。
- 独立 Test（TesterIdleScan）：复跑 typecheck + 全量套件 + 5 个触碰测试文件（37/37），负向控制逐一核实为真反例，verdict **passed**。
- 独立 Review（ReviewerIdleScan）：验收 1-4 逐项对照代码验证（含 SDK 源码、S3 逐字 diff、通知覆盖），verdict **passed**；P3 发现（reload 取戳时序）已修复并经同一评审在 worktree 确认关闭。
- A/B 基准：同一副本（347 会话、0 待运行、假 provider）——改动前 42s 窗口 62s CPU（148%）/RSS ~940MB；改动后同窗口 0s CPU（全程 1 CPU 秒）/RSS ~50MB，GET / 200。数字为记录证据，Tester 未复跑。

## 知识更新

- `docs/technicalnew/validation.md` 追加本条验证记录（结算输出）。
- 行为契约无变化：S3/storage-and-recovery.md、runtime-contract.md 的对外语义不变；R5 的"可见时机"按用户决定明确为"文件变化即生效"，已记入验证记录与 provider-config 测试注释。架构图 A2"唤醒 / 扫描"表述仍准确，不需修改。

## 待办与遗留

- 无新增待办。遗留边界（不阻断）：同毫秒同大小重写不被戳感知（保存路径有 reload 兜底）；戳变化瞬间并发 isAvailable 可能重复一次全量刷新（SDK seq 保护，最终正确）；浏览器 E2E 未运行（Plan 记录）；基准数字未由 Tester 复跑。

## 保存

- 交付路径（相对 HEAD 提交）：`kaiming/src/store/store.ts`、`kaiming/src/server/worker.ts`、`kaiming/src/runtime/pi-runtime.ts`、`kaiming/test/worker.test.ts`、`kaiming/test/provider-config.test.ts`、`kaiming/test/worker-idle-scan.test.ts`、`kaiming/test/availability-cache.test.ts`、`kaiming/test/store-statement-reuse.test.ts`、`docs/technicalnew/validation.md`、本目录（plan/review/settlement）。
- 运行中的 workbench（若在跑旧代码）需重启后才获得本优化。
