# Implementation Summary · devagent-p2-runtime-20261005

```yaml
implementation:
  task: devagent-p2-runtime-20261005
  changed:
    - path: devagent/src/store/store.ts
      purpose: schema v2（session_inputs 增 effectiveConfig/checkpoint + v1→v2 迁移）、recordEffectiveConfig、finishInput 接受 checkpoint、getSession、epoch 读取
    - path: devagent/src/runtime/config.ts
      purpose: 有效配置解析（角色覆盖 → 项目默认 → 服务器默认，纯函数）与去敏视图
    - path: devagent/src/runtime/hash.ts
      purpose: 稳定 JSON 摘要（配置指纹）
    - path: devagent/src/runtime/pi-runtime.ts
      purpose: 共用 ModelRuntime + 每个逻辑会话一个 Pi 实例；可用性按 SDK 自身凭证解析判定；显式 cwd/model/工具/文件绑定
    - path: devagent/src/runtime/registry.ts
      purpose: 会话注册表：复用实例；配置变化时重建；可核对实例数（防泄漏）
    - path: devagent/src/runtime/runner.ts
      purpose: 执行链路：可用性预检 → 认领 → 书签 → 投递 → 等实际停稳 → 按消息级事实+磁盘核对分类 → 写边界与终态；停止路径
    - path: devagent/test/runtime.test.ts
      purpose: 运行时单元/集成测试（10 项，stub 端点）
    - path: devagent/test/store.test.ts
      purpose: 新增 v1→v2 迁移用例；schema 版本期望更新（17 项）
    - path: devagent/checks/runner-real-model.ts
      purpose: 真实模型端到端检查（走完整执行链路）
    - path: devagent/package.json
      purpose: 新增 check:runtime 脚本
  behavior:
    - "实测：npm test 46/46 通过；typecheck 退出码 0；SDK 试验 47/47 无回归；check:model 4/4；check:runtime 4/4（真实模型）"
    - "认领前先做两项预检：模型可用性（不可用→blocked_config）与工作目录可访问（不可用→blocked_project）；两者都让输入保持 queued，不静默换模型也不认领"
    - "会话准备失败（例如绑定的历史文件缺失）也会被记录为 interrupted，绝不把已认领的输入留在 processing"
    - "投递前追加书签（agentdev.input-marker，含 inputId/摘要/代次），投递后按「marker 子树内第一个 role=user」定位根输入条目；checkpoint 只有在**从磁盘读回**该文件并确认书签、根条目、叶子都在时才成立"
    - "终态只由事实推导：stopReason=error→failed（本次运行有停止记录时→stopped）、aborted→stopped、边界不可确认→interrupted、其余且边界可验证→completed"
    - "结束写入使用**当前持久 revision**（运行期间可能被停止请求推进），避免因 stale revision 把输入卡在 processing"
    - "会话绑定持久化（session_bindings）：配置变化重建实例时按原 piFile 恢复历史，不新开一份历史"
    - "投递阶段任何异常（书签写入失败、Pi 文件写入失败、读回失败）都收敛为 interrupted，不向外抛异常、不伪装成功"
    - "同一会话复用同一 Pi 实例；配置变化时销毁重建；注册表计数可核对（无实例泄漏）"
  review_round_1:
    - 独立只读审阅判定 failed：4 项 blocking
    - (1) 认领前置条件不全且会话准备在保护范围之外 → 已补目录预检（blocked_project）并把准备失败收敛为 interrupted，不再留下 processing
    - (2) 运行中停止无法落库（停止请求推进了 revision + 未登记 abort，导致按 stale revision CAS 失败并误判为模型错误）→ 已把 abort 登记改为输入级、结束写入改用当前 revision，并新增「运行中停止」并发用例
    - (3) 配置变化重建实例会丢失历史 → 新增 session_bindings 绑定与按原文件恢复，并补配置变化用例
    - (4) checkpoint 只看内存条目、未核对磁盘 → 新增磁盘读回校验（书签/根条目/叶子必须真实存在），补读回单测与「读不回即 interrupted」用例
    - 第二轮独立复审（新上下文）结果见 review.md
  review_round_2:
    - 第二轮审阅判定 failed：3 项 blocking + 1 项 non-blocking（比第一轮更深）
    - (1) 认领后的失败路径用旧 revision 收尾且忽略写入结果：构造期间到达的停止请求会把行卡在 processing → 新增 finishWithCurrentRevision（按当前行 revision 写入），所有认领后失败路径与终态写入统一走它；新增「构造中到达停止」的确定性用例
    - (2) 注册表只按配置指纹复用实例：绑定的历史文件消失后仍继续跑 → 复用前校验绑定文件存在且与实例一致，否则销毁并抛 HISTORY_UNAVAILABLE；新增「两次运行之间删除绑定文件」用例
    - (3) 边界读回只比对 ID 集合：陈旧/无关文件也可能通过 → 改为结构校验（会话头、书签 customType 与 inputId/requestDigest、根条目必须是该 marker 的首个 user 消息、叶子必须从根可达），并补正反用例
    - (4) getSessionBinding 漏掉 rulesHash → 已补全并返回
    - 增量复核（同一独立会话）结果见 review.md
  findings_for_implementation:
    - "**取消在 Pi 里表现为普通错误**：工具内 ctx.abort() 后 prompt() 仍 resolve，最后一条 assistant 消息是 stopReason=error + errorMessage=\"This operation was aborted\"。因此不能靠比对文案区分「用户/宿主停止」与「模型报错」；runner 增加 noteAbort(sessionId)，由宿主自有的工具在 abort 前登记，未登记时如实记为 failed（测试同时覆盖这两种情形）"
    - "失败的运行仍会真实落地（Pi 已停稳），因此 failed 也保留 checkpoint；只有 interrupted 才没有可靠边界"
    - "中断路径必须覆盖「第一次 Pi 写入就失败」：书签 appendCustomEntry 也会因文件不可写而抛错，必须收敛为 interrupted，否则输入会一直留在 processing"
    - "**历史连续性要显式绑定文件**：实例重建时若不给原 piFile，Pi 会新开一份历史；必须把会话到文件的绑定持久化（session_bindings）并在重建时按原文件恢复"
    - "**checkpoint 必须从磁盘读回核对**：只凭内存条目与路径会把「文件已丢/已损坏」的输入记成 completed；读回失败一律 interrupted"
    - "**结束写入要用当前 revision**：运行期间可能发生停止请求（会推进 revision），用认领时的 revision 收尾必然 CAS 失败并把输入卡在 processing"
    - "**「已绑定历史不见了」不是可忽略的情况**：实例复用前必须核对绑定的文件仍然存在且就是该实例使用的文件；否则必须销毁实例并按 HISTORY_UNAVAILABLE 阻断，而不是继续写出一份残缺的新历史"
    - "**边界校验要按结构而非 ID 集合**：只比对 ID 会让陈旧或无关文件通过；必须校验会话头、书签身份、根条目是首个 user 消息、叶子从根可达"
  plan_deviation:
    - 输入内容本轮只支持文本；非文本内容直接判为 failed(INVALID_ARGUMENT)，已在测试记录与不覆盖项中写明
    - 角色/项目覆盖本轮由调用方注入的 RuntimeDefaults 提供（尚无配置服务/HTTP 层）；配置来源已记录在 effectiveConfig.source
    - **S3 的「控制允许」前置条件未实现**：Task 表与领域工具属 P3，本包只强制存储层规则（同会话运行中 / 未核实中断）；已在代码注释与不覆盖项中写明
  document_impact:
    - 契约未改；checkpoint/effectiveConfig 字段与 S2 一致
  risks_remaining:
    - 真实模型的长期多轮行为（是否恰当使用工具、是否遵守项目规则）仍属 I4 场景表
    - file_saves 跨存储顺序、Task 级控制、HTTP/UI 仍属 P5/P4
```