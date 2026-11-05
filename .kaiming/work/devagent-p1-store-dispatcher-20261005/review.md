# Review Report · devagent-p1-store-dispatcher-20261005

## Round 1 · 独立只读审阅（会话 P1StoreReview）

```yaml
review:
  task: devagent-p1-store-dispatcher-20261005
  reviewer_session: P1StoreReview   # 独立上下文，只读，未见开发聊天
  scope: "store.ts / dispatcher.ts / 两个测试文件 对照 S1–S3、R2/R3"
  method: "通读代码 + 在 $TMPDIR 用探针脚本复现（node v24.8、node:sqlite、无模型）"
  findings:
    - severity: blocking
      location: devagent/src/store/store.ts:236
      evidence: "请求摘要只含 {method,payload}，同 requestKey 改 sessionId/projectId/taskId 被静默去重（探针 CASE1/1b 返回 deduped:true 且 s-2 无记录）"
      impact: "违反 R1『同 ID 不同归属/内容返回 REQUEST_CONFLICT』；第二次的输入永远不会被接纳，且返回值无法看出归属错误"
      remediation: "摘要纳入完整归属"
      status: fixed
    - severity: non-blocking
      location: devagent/src/store/store.ts:390-391
      evidence: "scanStartup 未按 serverEpoch 过滤；同进程内再次调用会把运行中的 processing 打成 interrupted，此后 finishInput 永远关不掉（探针 CASE2）"
      impact: "周期性扫描或第二个 Store 实例会破坏在跑的工作，会话从此卡在 RECOVERY_REQUIRED"
      remediation: "按外来代次过滤；同代次不触碰"
      status: fixed
    - severity: non-blocking
      location: devagent/src/store/store.ts:419-424
      evidence: "停止意图的兜底分支无状态守卫、不升 revision；对 completed 行二次调用会覆盖 stopRequestKey（探针 probe2）"
      impact: "改写历史行；违反 R2『每次持久变化 revision 加一』，按 revision 轮询的调用方看不到意图写入"
      remediation: "仅 processing/interrupted 可写、revision+1、同 key 幂等、终态不改"
      status: fixed
    - severity: non-blocking
      location: devagent/src/store/store.ts:344-354
      evidence: "tryClaimInput 只校验 status='queued'，公开方法可让同一会话出现两条 processing（探针 CASE4）"
      impact: "『同一 Session 只有一个执行所有者』只在所有人都走 claimNextInput 时成立"
      remediation: "加部分唯一索引 + WHERE NOT EXISTS"
      status: fixed
    - severity: non-blocking
      location: devagent/src/store/dispatcher.ts:39-42,49-56
      evidence: "遇到阻断会话即返回/终止本轮，后续就绪会话不被认领（探针 CASE3：drain 只返回 blocked）"
      impact: "与 S7『恢复入口直接服务，不排在中断输入后』相悖，就绪会话被饿住"
      remediation: "记录阻断并继续服务其它会话，本轮末尾报告一次"
      status: fixed
    - severity: non-blocking
      location: .agentdev/work/devagent-p1-store-dispatcher-20261005/implementation.md:26-33
      evidence: "计划内的 Task 级暂停/取消意图被丢弃但未记入偏差；S2 其余字段与 S3 认领前置条件未逐项声明"
      impact: "读者无法从记录区分『已实现/已推迟』"
      remediation: "补 plan_deviation 与 not_covered 条目"
      status: fixed
    - severity: non-blocking
      location: devagent/test/store.test.ts:97-99,163-175
      evidence: "冲突用例只断言抛 StoreError（不校验 code）；『并发』用例实为单线程顺序调用"
      impact: "两处断言都不能反驳其命名的命题"
      remediation: "断言具体 code；冲突覆盖归属变化；并发表述改为存储层不变式"
      status: fixed
  overclaims:
    - "『同 key 改参数抛 REQUEST_CONFLICT』对归属变化不成立 → 已修复并补用例"
    - "scanStartup 描述为只处理遗留 processing，实际会打到当前代次 → 已按代次过滤"
    - "测试记录中的『并发 CAS』实为顺序调用 → 已改为存储层不变式表述"
    - "RECOVERY_REQUIRED 未登记在 R6 错误目录（内部码，非缺陷）→ 已在结算记为待确认"
  result: failed   # 1 项 blocking
```

## Round 2 · 修复后独立复审（会话 P1StoreReview2）

```yaml
review:
  task: devagent-p1-store-dispatcher-20261005
  reviewer_session: P1StoreReview2   # 新独立上下文，只读
  reproduced:
    - "cd devagent && npx tsc --noEmit  # exit 0"
    - "cd devagent && npm test          # 21/21（store 15、dispatcher 6）"
    - "cd devagent && npm run spikes    # 47/47"
  regression: none
  round1_verified:
    - "请求摘要纳入归属：改 sessionId/taskId/projectId 均抛 REQUEST_CONFLICT；同参数重试返回原结果且目标会话无记录"
    - "按代次扫描：同代次再扫描返回 {interrupted:0} 且运行中可正常收尾；外来代次（含 serverEpoch 为 NULL 的遗留行）仍被正确分类"
    - "停止意图：仅 processing/interrupted 可写、版本+1；终态行在迟到停止后逐字段不变"
    - "一会话一运行中：NOT EXISTS + 部分唯一索引；直接 tryClaimInput 返回 false，手里只有 1 条 processing；第二连接返回 busy"
    - "调度：待恢复会话不再终止本轮，drain = [claimed:s-3, blocked]"
    - "记录：不覆盖项与偏差已补齐；冲突用例断言具体 code；『并发』表述改为存储层不变式"
  findings:
    - severity: non-blocking
      location: devagent/src/store/store.ts:526（migrate 版本短路）
      evidence: "旧版数据库（user_version=1）不会执行建索引语句，第二道防线在升级库上缺失"
      remediation: "把索引创建移出短路，并对重复运行行给出明确 VERSION_CONFLICT"
      status: fixed   # 已无条件重建并包裹错误
    - severity: non-blocking
      location: devagent/src/store/dispatcher.ts:42-46
      evidence: "多会话待恢复时只报第一个，后续会话永不被报告"
      remediation: "报告后推进游标"
      status: fixed
    - severity: non-blocking
      location: devagent/src/store/store.ts:438-440
      evidence: "queued→stopped 的重试返回 stopRequested 由 true 变 false"
      remediation: "按已记录结果返回（stopped 也算已停止）"
      status: fixed
  result: passed
```

### 增量复核（会话 P1StoreReview2，2026-10-05 追加）

对三项修复与新增用例的复核：**passed**，无回归（tsc 0、22/22、47/47）；三项修复均被证实可失败（旧行为下新用例会失败）。残留 non-blocking：重复运行行→VERSION_CONFLICT 的路径缺少仓库用例（已补，计数随之到 22/22）、记录中的测试计数未同步（已改）、review.md 的 Round 2 段仍是占位（已补）。