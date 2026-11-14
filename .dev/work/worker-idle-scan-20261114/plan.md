# Plan: kaiming 空闲 CPU 治理（worker 空闲扫描削减 / 可用性快照 / 语句缓存）

Task key: `worker-idle-scan-20261114`（repo 级代码工作，用户在会话中明确指令）
日期: 2026-11-14 · workKind: implement · 验证档: **broad**（worker 调度循环 + store 公共层改动）

## 背景与依据

实测生产进程（PID 79643，运行 7h40m）：平均 1.56 核 CPU、1.0G RSS，且与是否有任务无关。CPU profile（CDP）证据：

- `WorkbenchWorker.run` 每 250ms 对 store 里**全部** session 逐一调 `runner.runNext`（空转时 ≈1384 探测/秒）；
- 每次探测同步执行：`getSession`/`resolveConfig` 多条 SQL（每条独立 `db.prepare`）+ `factory.isAvailable` → SDK `getAvailable()` 不带 providerId → `queueAvailabilityRefresh` 对 42 个内置 provider 逐个 `checkAuth`（每 provider 凭据文件 statSync+读盘+env+一次性 AbortSignal 监听）+ `checkProject` fs.access + `claimNextInput` 事务；
- GC 占 profile 19.5%，为上述分配 churn 的结果；额外 ~0.5 核来自 V8 GC 工作线程。

依据文档：docs/technicalnew/storage-and-recovery.md（S3 认领算法不变）；docs/technicalnew/runtime-contract.md（对外行为契约）；AGENTS.md（质量门/验证档）。

## 目标

空载 CPU 不再随 session 表线性增长；同一数据副本、同一启动参数下，空载平均 CPU 相对基线 A 显著下降；一切对外行为（认领、blocked/controlled/busy 结果面、R5 配置生效语义、恢复语义）保持不变。

## 范围

改：`kaiming/src/server/worker.ts`、`kaiming/src/store/store.ts`、`kaiming/src/runtime/pi-runtime.ts`、`kaiming/test/worker.test.ts`（契约更新：无输入 session 不再被探测）、新增针对性测试。
不改：S3 认领算法、恢复语义、task 工具、hub/SSE、read/write methods、webapp、文档契约语义；不新增模块/状态机。

## 实施步骤

1. **空闲过滤**：store 新增 `listRunnableSessionIds()`（`SELECT DISTINCT sessionId FROM session_inputs WHERE status IN ('queued','processing','interrupted') ORDER BY sessionId`）；`WorkbenchWorker.run` 每轮只探测该集合；worker 头注释与 `notify` 语义说明同步更新。`processing` 保留探测面（busy 结果），`interrupted` 保留 RECOVERY_REQUIRED blocked 结果面，`queued` 覆盖 controlled/claim。
2. **可用性快照**：`PiRuntimeFactory.isAvailable` 改用内存快照 + (mtimeMs,size) 失效——models.json / auth.json / models-store.json 任一变化才 `runtime.refresh({allowNetwork:false})`；`reload()` 复用同一刷新并更新失效标记（R5 双保险：正式保存路径本就调用 reload）。
3. **语句缓存**：store 增加 `stmt(sql)`（Map 按 SQL 文本缓存 StatementSync），全部静态 prepare 点改走缓存；`close()` 清缓存。动态 SQL（placeholders IN、pragma_table_info）以最终文本为 key，受形状数天然约束。
4. **测试**（TDD 红→绿）：
   - 新 `test/worker-idle-scan.test.ts`：无输入 session 不被探测（负向控制：改动前的旧行为必须被拒绝）；queued/processing/interrupted 三态仍被探测；notify 唤醒后新队列 session 被探测。
   - 新可用性测试：monkey-patch SDK 全量路径抛错，断言快照命中不触发全量刷新（负向控制：杀"没有真正缓存"突变）；手改凭据/模型文件后下一次 isAvailable 反映新状态（杀"缓存不失效"突变，保 R5）。
   - 语句复用回归：同一方法不同绑定参数多次调用结果各自正确（杀"绑定串状态"突变）。
5. `npm run typecheck` + `npx vitest run` 全量（broad：公共层改动；全量浏览器 E2E 不跑，记录为未运行）。
6. **A/B 实测**：基线 A（改动前，副本 347 会话/0 待运行，KAIMING_MODEL_PROVIDER=bench 阻断真实投递）已测；改动后以新副本同参数复测 B；两组数字记入验证记录。
7. 独立 Review → 独立 Test（子 Session，不读开发聊天）→ 结算（validation.md 追加证据、AGENTS 无规则变化不更新、提交交付路径）。

## 验收（可观察）

1. 空转多轮后，无任何输入的 session 的 `runner.runNext` 调用次数为 0；三类保留状态 session 的探测与结果类型序列与改前一致。
2. R5：手动改 agentDir 凭据/模型文件后，下一次 `isAvailable` 立即反映；快照命中时 SDK 全量刷新路径未被调用。
3. 全量 vitest 通过（含新增负向控制）；worker.test.ts 更新后的契约成立。
4. B 相对 A 空载 CPU 显著下降（数字入验证记录）。

## 风险

- 过滤集合漏状态 → 状态全集来自 `claimNextInput` 的三种非 idle 结果（busy→processing、blocked→interrupted、claimed/controlled→queued）；用集合覆盖 + 全量回归兜住。
- 同毫秒同大小重写凭据文件（mtime+size 不变）→ 正式保存路径有 `reload()` 兜底；记录为已知边界。
- notify 未触达的时延 → 空闲 tick 仍为 250ms，最坏时延不变。

## 用户决定事项

无（三项优化即用户明确指令；本 Plan 在授权范围内展示后继续）。
