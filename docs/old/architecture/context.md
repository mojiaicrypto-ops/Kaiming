# 知识与Context实现

## 1. 输入权威与读取

Chief提交ContextSelection，Builder完成授权、来源解析、必需项补齐检查与冻结。输入来源必须是ref（Git path+revision、Artifact id/version、Policy revision、角色契约）；任意字符串正文须标为task_instruction而不能伪装来源。

选择顺序：Project概览→当前Work/Requirement/Task→Feature导航→直接关联约束→角色需要的正文/代码/测试。Chief为每个条目填写reason。Builder拒绝不可访问来源，缺必需项返回MISSING_CONTEXT，不自动展开整个模块。

ContextSnapshot保存selection、resolvedSources（path/ref、hash、bytes、revision）、excluded、unknowns、policy/config hash、createdAt。实际内容复制进不可变快照目录，避免后续文件改变污染已启动Run。Snapshot目录只挂载该Run允许的文件。

追加读取只能在readScope内，写read ledger（seq、path、revision/hash、reason、size），阶段结果绑定ledger最后seq及hash。readScope默认同Project当前冻结源码和正式文档；执行记录需按角色ACL。需要读更广范围由context.request返回Chief处理，授权未完成不读取。

## 2. 知识格式与投影

Feature Markdown第一段为字段表，键：feature_id/name/module/owner_document/design/design_decision_refs/implementation/verification/verification_evidence_refs/verification_coverage/investigation/investigation_scope/source_refs/revision；之后必须存在“用途”“当前行为”“关系”“实现入口”“已知差距”“关键决定”标题。关系为四列表target_feature_id/kind/reason/source。来源ref必须可解析为Git路径、Decision或Artifact。

示例：

```markdown
# 订单取消
| 字段 | 值 |
|---|---|
| feature_id | F-a1b2c3d4 |
| name | 订单取消 |
| module | orders |
| owner_document | features/F-a1b2c3d4/README.md |
| design | confirmed |
| design_decision_refs | decision:<真实ID> |
| implementation | implemented |
| verification | passed |
| verification_evidence_refs | artifact:<真实ID>@1 |
| verification_coverage | 未付款可取消；已付款拒绝 |
| investigation | investigated |
| investigation_scope | 订单取消路由、状态转换和测试 |
| source_refs | git:<真实SHA>:src/orders/cancel.ts |
| revision | <真实Git SHA> |

## 用途
允许用户取消未付款订单。
## 当前行为
已付款订单返回已确认的拒绝结果。
## 关系
| target_feature_id | kind | reason | source |
|---|---|---|---|
| F-e5f6a7b8 | constrained_by | 付款状态决定可取消范围 | product/payment.md |
## 实现入口
- src/orders/cancel.ts
- tests/orders/cancel.test.ts
## 已知差距
无已登记差距。
## 关键决定
- decision:<真实ID>：已付款取消使用退款流程。
```

上述字段均必填；多值引用采用分号分隔，空值用“无”或“未调查”。owner_document必须等于本文件相对document-root路径；design=confirmed时design_decision_refs至少一个有效用户Decision/授权来源或Git需求记录的confirmedDecisions引用，verification=passed时verification_evidence_refs非空、coverage非空且Revision/代码树与证据一致；Clone可引用Git需求completion摘要，标summary_only而不作为本机测试结果，investigation=investigated时scope/source_refs非空。Observed实现可先记录implementation与sources，同时design=unconfirmed。缺乏对应证据不得使用confirmed/passed/investigated。示例占位只能用于模板，写入正式Feature时必须是真实值。重复ID、未知枚举、缺必需标题为KNOWLEDGE_INVALID；不发布新投影，保留最后有效投影并标stale。断链为诊断，影响当前需求则阻断相关交付；无关区域可以部分就绪。空关系/入口须写“未调查”或“无”，不能用空表暗示已覆盖。

解析采用Markdown AST，以Heading/表头识别；不执行内联HTML。索引来源是正式Git文件。SQLite feature_projection按revision+featureId主键缓存，fts5仅索引名称、用途、路径、关系原因；可由Git重建。

## 3. 查询视图

knowledge.get默认view=delivered，指向agentdev/main HEAD。view=design显示同HEAD的已确认设计和独立实现状态；view=work需要workId，加载baseRevision+工作ProductDefinition覆盖层，明确标记尚未交付。所有响应含sourceRevision、projectionState和unknowns。

工作层不修改其他Work视图。集成前比对基线是否改变；同Feature并行修改通过重新分析和Review处理。验证passed只对记录的代码树和覆盖集合成立，Revision改变时投影显示需要核对，不能自动沿用绿色通过。

## 4. 初始化事务

初始化使用work.intent=document、purpose=initialize，无Requirement。Chief分派Product调查/定义，必要时Backend只读调查；写入由Product/Planning候选Worktree→Review→Settlement。操作记录保存cursor、read manifest、draft refs及用户确认，暂停/取消使用通用Work控制。

无Git时只保存调查Artifact，用户授权Git初始化后再创建候选Worktree。已存在文档先比较Hash并展示Diff；writing开始后崩溃按结算恢复。初始化Ready条件：四入口可解析、至少一个真实能力或明确空项目状态、来源/未知可发现、文档Review通过。

## 5. 冷启动与会话

新Conversation从Chief固定规则、Project概览和当前领域摘要开始，Chief按用户问题继续选择；不依赖旧Conversation全文。跨物理Session保存Checkpoint字段：work/task/stage、有效Manifest、pending decisions、artifact refs、last tool outcome、next action、recent messages refs。Checkpoint仅来自当前Run，用于暂停/恢复；正式事实总是从有效引用重建。

超过Context阈值由Pi原生Compaction减少近期上下文；SDK事件记录压缩开始/结束。权限、规则和阶段所需事实由新Snapshot重建，Compaction不能改变批准状态。Reviewer不能访问其他Run的Session/Checkpoint，即使Shared Artifact搜索也必须按ACL过滤。

## 6. 质量验证

固定样例包含订单、支付、会话三个Feature及关联；两次交付后冷启动要求找到当前取消行为、支付约束、相关测试路径及已知差距。相同任务放入20份无关文档验证不默认注入。另放开发聊天中的误导结论，Reviewer的读取轨迹必须没有该Transcript且能发现真实代码缺陷。

Context充分性不能通过Agent一句“足够”验收；检查必需输入和固定样例事实召回，真实任务记录遗漏并修正关联。预算用完时返回可定位缺口而非全库读取。

需求目录上下文按同一Revision加载requirement.json与content.md，核对正文Hash后分别登记来源；元数据确定状态/引用，正文提供详细行为，正文不能授予工具权限。Product/Plan检查两份事实是否一致；冲突阻断依赖这些事实的执行并交Chief处理。
