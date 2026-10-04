# Pi 优先实施与简化复审

日期：2026-10-04。正式文档基线：`67b53e25fce6eb618fc2902a5284357c2a477fcf`。本记录是讨论建议，不改变生效需求或技术契约。

## 审查范围与独立性

主审读取当前 AGENTS、INDEX、productnew 与 technicalnew 的适用链路，并复核前次审查仍开放的场景。三个无会话历史的独立审查者分别冷读当前文档：

- `/root/pi_native_simplicity_review`：原生接口、工具、容量与宿主边界。
- `/root/minimal_product_decisions_review`：真实产品冲突与必要决定。
- `/root/thin_host_developer_review`：薄宿主能否实施、恢复和结算是否过重。

独立审查者未读旧设计、业务实现或此前审查报告，均只读。固定 Pi checkout 经 exact-match 确认为 v1.0.0；主审同时浏览官方 SDK、会话及工具示例。没有运行 SDK、真实模型或故障/浏览器试验。

## 结论

全局 Server、独立 Pi Session、Task/委派持久化、通用 UI 问答和 Pi 事件广播的主线已经足以开展最小接入试验。不能据此认定全部公共契约已无歧义。当前主要风险是宿主承担了逐工具效果恢复、通用验证依据判定与结算证明；这些责任比核心产品需要的首版实现更重。

下面四项应优先收敛，其余工程补齐不应逐项要求用户决定。建议保留专业协作、独立 Review 后 Test、结算与项目知识更新。

## 优先讨论

| 项目 | 当前场景/依据 | 推荐最小决定 |
|---|---|---|
| 首版恢复承诺 | [S4](../../../docs/technicalnew/storage-and-recovery.md#s4-关键操作与-checkpoint) 要给原生 edit/write/bash 建意图和回执；S7 又处理 Pi/DB 回执差异 | 首版恢复 Task、会话历史和已知成果，核实后继续剩余工作；不承诺恢复旧工具栈或透明重放任意 Shell。宿主持久化其接纳、Task、委派、交互、结果和自管文件保存；原生 Local 执行仍归 Pi |
| 结算的机器核对程度 | [G3](../../../docs/technicalnew/agents-and-tools.md#g3-总体-plan候选与完成核对)、[S6](../../../docs/technicalnew/storage-and-recovery.md#s6-文件结果与结算的跨存储顺序) 把所有非 analysis 工作纳入候选复制、依据摘要和结算清单 | 保留真实独立验证、资料更新和保存回执；程序核对身份、必要记录、版本/控制和保存成功，AI 判断语义覆盖、实质需求变化及文档更新是否合理。候选先用足够识别实际成果的版本/文件记录，不强制每次复制完整项目 |
| 并行批次何时交还主管 | [M2](../../../docs/technicalnew/messaging-and-collaboration.md#m2-委派等待协议) 一个成员 blocked 就返回，continue 另建批次；旧批次再次 wait 会重复看到原 blocked，剩余成员等待未定义 | 首版普通业务阻断等整批工作停稳后汇总返回；用户确认仍直接经 UI/WAL 处理。暂停、取消或执行故障可控制剩余工作，再以真实状态收口，不假装已完成 |
| 只读分析产物位置 | [P-02](../../../docs/productnew/modules/project-workspace.md#p-02-首次协作与项目知识入口) 允许先只读调查，但 G2/S6 要 analysis 写项目 Plan/报告 | analysis 的安排与报告保存在现有 Server 状态存储；正式修改才使用项目内 Plan。保持 Task 与专业 Session 关联，不要求调查先取得项目写入授权 |

## 可以直接简化或补齐的技术选择

1. **语义权限交给模型规则，宿主保存事实。** G1/G2/S4 的“核对 Plan/授权范围”不能要求程序理解自然语言，也不能声称 Local bash 能按文件用途阻止写入。角色工具白名单、身份、控制、目录责任及真实产物仍由宿主核对；通用授权解析/命令权限引擎没有必要。
2. **限制专业 Session 并发，不先做逐模型请求公平调度。** R3:107、S3:92 的细粒度容量可包装公开 agent.streamFunction 实现，但不是 SDK 自动提供。首版可限制专业 Session 并发，主管等待不占子工作名额；所有等待可取消。若采用，必须同步原技术契约，不能暗中改变语义。
3. **使用原生搜索与配置能力。** G1 的只读角色可直接选 read/grep/find/ls；模型和凭证使用 ModelRuntime，设置和资源采用 SettingsManager/ResourceLoader。Web CRUD/试连仍需本产品 API，不能声称 SDK 已提供 Web 入口。
4. **交互只接当前工具调用。** ctx.ui 不带 toolCallId，也不返回 interactionId。以已有 execute 上下文关联问题和答复是小规模接线，不能把它扩成任意扩展调用恢复框架。requested/presented 是否都持久化也可再简化：已保存且有效的请求足以接收答复，页面看到与否是呈现事实。若保留 presented，必须先提交状态再广播，避免 UI 立即答复时被拒绝。
5. **补公共接口和维护边界，不升级成用户决策。** R1 的配置、文件阅读、认证及清理入口需补方法表；损坏需求通过既有 save+CAS 修复需明确身份依据。M3:115 的“主体版本”、S5:143 的等待规则归属是简化后的残留引用，直接归一化即可。

## 次要产品行为应写清

- **忙碌期间的消息**：同步委派时主管不能并发处理普通聊天；Pi steer 也不会越过仍未结束的工具。首版可明确普通消息排队、即时暂停/取消走现有控制按钮。不能含糊承诺聊天“暂停”立即生效。当前 Task 的补充需要说明实际消费边界，不能只写“安全边界”。若要在当前工具返回后就送入主管，先验证原生 steer 并定义 WAL 投递关联。
- **取消的含义**：取消本次 Task 与取消需求目标分开；前者停止本次执行并保留需求与成果，后者先停关联工作再显式保存需求 cancelled。暂停需求仍 in_progress。具体 Task 取消后的可重启状态应统一写入 R-05，不自动猜测同步。
- **未覆盖门禁**：D-05:70 对所有非阻断覆盖缺口要求用户处置偏重。建议仅必要验收缺失或重要风险需要决定；已在真实输入中明确排除的检查、额外建议如实记录，不再强制新 question。S6 处置引用应可引用真实用户输入或交互答复。

## 与前次发现的关系

前次 DA-03 已按确认后的通用问答边界关闭。DA-01/02 仍是本轮复核后的具体冲突；DA-04 与机器结算/依据判定责任有关，应随边界简化解决；DA-05 需要给只读核实明确准入而非新增恢复工作流；DA-06/07 属于接口和维护契约补齐；DA-08 是取消目标的产品语义。没有直接将全部旧发现提升为新的用户审批事项，也没有擅自关闭未修复项。

## Pi 与宿主的分工

| Pi 原生承担 | AgentDev 必须补齐 |
|---|---|
| Session/JSONL、压缩和分支、模型循环、原生工具、取消、原生事件、扩展 UI 与资源配置 | 项目/Task/子 Session 归属、持久接纳和委派、用户答复 WAL、Web 消息适配与查询、交付规则及项目结算 |

主源：[SDK](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/sdk.md)、[会话示例](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/examples/sdk/11-sessions.ts)、[工具示例](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/examples/sdk/05-tools.ts)、[streamFunction](https://github.com/earendil-works/pi/blob/v1.0.0/packages/agent/src/agent.ts#L194-L203)、[UIContext](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/src/core/extensions/types.ts#L149-L157)。Pi 的会话历史恢复不等于宿主任意工具副作用或等待栈的耐久恢复。

建议下一步优先确认恢复目标和结算核对边界，再统一修改相关技术契约。无需等待通用恢复引擎才能开始固定 Pi 的最小接入验证。
