# Settlement Report · devagent-p2-runtime-20261005

```yaml
settlement:
  task: devagent-p2-runtime-20261005
  stable_facts:
    - "运行时：有效配置解析（角色 → 项目 → 服务器默认，纯函数并记录来源）+ 去敏视图；共用 ModelRuntime；每个逻辑会话一个 Pi 实例"
    - "认领前两项预检：模型可用性（blocked_config）与工作目录可访问（blocked_project）；都让输入保持 queued，不静默换模型"
    - "认领后的全部步骤在同一保护块内；失败一律落库分类：写 Pi 之前 → PROJECT_UNAVAILABLE/HISTORY_UNAVAILABLE，写之后 → HOST_SAVE_FAILED；绝不把任何可写输入留在 processing"
    - "投递：先写输入书签（agentdev.input-marker，含 inputId/摘要/代次），再交付；根输入条目取「marker 子树内第一个 role=user 消息」"
    - "终态只由事实推导：stopReason=error→failed（运行中有停止登记时→stopped）、aborted→stopped、边界读回失败→interrupted、否则→completed；结束写入使用当前 revision"
    - "边界可信度：必须从磁盘读回并满足结构校验（会话头 cwd 身份、书签类型/身份/摘要、根条目为首个 user 消息、叶子从根可达；损坏环也能终止）"
    - "历史连续性：会话-文件绑定持久化（session_bindings，含 rulesHash），配置变化重建实例时按原文件恢复；绑定文件消失即阻断"
    - "证据：47 项单元/集成测试通过（store 17、dispatcher 6、model-config 5、runtime 19）；SDK 试验 47/47；真实模型端到端 4/4；宿主问答往返 4/4"
  updated:
    - "devagent/src/runtime/{config,hash,pi-runtime,registry,runner}.ts（新增）"
    - "devagent/src/store/store.ts：schema v2（effectiveConfig/checkpoint 列 + session_bindings 表 + v1→v2 迁移）、recordEffectiveConfig、finishInput checkpoint、getSession/getSessionBinding/recordSessionBinding、epoch"
    - "devagent/test/runtime.test.ts（19 项）、devagent/test/store.test.ts（迁移与绑定断言）、devagent/checks/runner-real-model.ts"
    - ".agentdev/work/devagent-p2-runtime-20261005/：plan/implementation/test/review/settlement"
  proposed_for_confirmation:
    - "运行时的 Pi 超时与重试策略尚未显式配置（当前用 Pi 默认：httpIdleTimeoutMs 300s、retry.provider.timeoutMs 同值）。若要容忍网关首字节慢/首事件超时，建议在运行时配置中显式给出 httpIdleTimeoutMs 与 retry 参数，而不是自建第二套重试"
    - "内部结果码（RECOVERY_REQUIRED / MODEL_UNAVAILABLE / PROJECT_UNAVAILABLE / HISTORY_UNAVAILABLE）目前多在存储与运行时内部使用；若经公开接口暴露，需登记到 R6 错误目录"
  indexes_updated:
    - none
  archived:
    - .agentdev/work/devagent-p2-runtime-20261005/
  no_change:
    - "docs/technicalnew 契约（实现按 S2/S3/R2-R5 落列，未改契约）"
    - "oldcode/、docs/old/、docs/architecturenew/、webui/（按 AGENTS.md 排除）"
  completion_gate: passed   # Round 1 failed → 修复 → Round 2 failed → 修复 → 两轮增量复核 passed（无新发现、无回归）
```