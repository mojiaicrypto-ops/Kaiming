# Review Report · devagent-p2-runtime-20261005

## Round 1 · 独立只读审阅（会话 P2RuntimeReview）

```yaml
review:
  task: devagent-p2-runtime-20261005
  reviewer_session: P2RuntimeReview   # 独立上下文，只读
  scope: "src/runtime/**、store 的 P2 变更、两个测试文件、真实模型检查脚本、任务记录"
  findings:
    - severity: blocking
      location: devagent/src/runtime/runner.ts:72-138
      evidence: "认领前只检查模型可用性；registry.acquire 在投递保护范围之外；工作目录/控制前置条件均未检查（S3）。构造失败会逃逸并让输入一直留在 processing"
      impact: "不该执行或无法执行的输入也会被认领并卡住，阻塞该会话后续输入"
      remediation: "认领前检查目录可用；认领后所有异常都要落库分类，不能让输入滞留 processing"
      status: fixed   # 新增目录预检 blocked_project；构造失败收敛为 interrupted(PROJECT_UNAVAILABLE)
    - severity: blocking
      location: devagent/src/runtime/runner.ts:169-210
      evidence: "运行中的停止请求会推进 revision 且未登记 abort；runNext 用认领时的旧 revision 收尾 → CAS 必失败、且按 stale 行判为模型错误，行留在 processing"
      impact: "最基本的用户停止路径无法落库，违反 S5 的 中止→停稳→写实际终态 顺序"
      remediation: "abort 登记改为输入级并在停止前调用；收尾使用当前 revision；补真正并发的停止用例"
      status: fixed
    - severity: blocking
      location: devagent/src/runtime/runner.ts:126-136
      evidence: "配置变化重建实例时未传 piFile，Pi 会新开一份历史（SessionManager.create），逻辑会话的历史被静默丢失（违反 R5）"
      impact: "换配置后同一会话的历史/上下文断裂，checkpoint 指向的文件也变了"
      remediation: "持久化会话-文件绑定并在重建时按原文件恢复；补配置变化用例"
      status: fixed   # 新增 session_bindings 与绑定读写
    - severity: blocking
      location: devagent/src/runtime/runner.ts:153-181
      evidence: "checkpoint 只看内存条目与路径，从不读磁盘；文件已丢/损坏仍会记成 completed"
      impact: "completed 对应的交付边界可能根本不存在，恢复不可靠"
      remediation: "从磁盘读回并核对书签/根条目/叶子；读不回一律 interrupted"
      status: fixed   # boundaryPersistedOnDisk + 单测与运行中锁文件用例
  overclaims:
    - "实施/测试记录声称已有可用性预检与中断收敛，但目录/控制未预检、构造失败会逃逸 → 已修复并更新记录"
    - "记录声称覆盖了运行中停止，实际只停了排队中的输入 → 已补并发用例"
    - "记录声称配置变化会诚实重建并保持同一逻辑会话，实际未传 piFile → 已修复并补用例"
    - "记录把 checkpoint 称作已确认的持久边界，实际未核对磁盘 → 已修复"
    - "迁移用例未在同一夹具中同时验证旧数据与索引 → 覆盖度说明不足（非缺陷）"
  result: failed   # 4 项 blocking
```

## Round 2 · 修复后独立复审（会话 P2RuntimeReview2）

```yaml
review:
  task: devagent-p2-runtime-20261005
  reviewer_session: P2RuntimeReview2   # 新独立上下文，只读
  findings:
    - severity: blocking
      location: devagent/src/runtime/runner.ts:160-169
      evidence: "认领后、构造保护范围之前的失败路径仍用旧 revision 收尾且忽略写入结果：构造期间到达的停止请求会把行留在 processing"
      remediation: "所有认领后失败路径按当前 revision 写入，并检查写入结果"
      status: fixed
    - severity: blocking
      location: devagent/src/runtime/registry.ts:31-34
      evidence: "实例复用只比对配置指纹：绑定的历史文件消失后仍继续使用该实例，等于在一份消失的历史上继续写"
      remediation: "复用前校验绑定文件存在且与实例一致，否则销毁并按 HISTORY_UNAVAILABLE 阻断"
      status: fixed
    - severity: blocking
      location: devagent/src/runtime/runner.ts:346-365
      evidence: "边界读回只比对三个 ID 的集合，陈旧/无关文件也可能通过"
      remediation: "改为结构校验：会话头身份、书签 customType 与 inputId/摘要、根条目必须是首个 user 消息、叶子从根可达"
      status: fixed
    - severity: non-blocking
      location: devagent/src/store/store.ts:610-634
      evidence: "getSessionBinding 未返回 rulesHash"
      remediation: "补全返回字段"
      status: fixed
  result: failed   # 3 项 blocking
```

### 增量复核（同一独立会话，两轮）

- 第一轮增量：又发现 3 项 blocking（认领后 binding/extras 在保护范围之外、书签摘要校验可被省略绕过、后代遍历无 visited 集会在损坏文件上死循环）+ 1 项 non-blocking（abort 登记在构造失败路径泄漏）→ 已全部修复（单一保护块 + deliveryStarted 分界、摘要必须存在且相等、头部 cwd 身份校验、visited 集、finally 统一清理 abort 登记）。
- 第二轮增量：**passed，无新发现，无回归**；审阅者另行枚举了认领后的全部路径，确认不存在会把可写输入留在 processing 的路径；并确认更严格的边界校验仍接受真实 Pi 历史（真实模型端到端检查通过），同时拒绝缺摘要、异目录、断链、不可达叶子、损坏 JSON、缺失文件与环。