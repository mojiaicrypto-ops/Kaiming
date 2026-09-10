# 需求池与Git可迁移性

## 1. 产品契约

Requirement是产品长期知识。用户保存的未实现需求必须随项目Git保留；已实现需求保存完成摘要并可查询。换服务器仅Clone代码与正式文档，即可恢复需求池和历史需求列表，无需旧数据库、聊天、模型配置或运行环境。

需求事实固定保存于仓库根目录.agentdev/requirements/<requirement-id>/，不随documentRoot变化。每个目录内requirement.json保存结构化元数据，content.md保存详细正文；二者共同构成当前需求事实，Git历史保存修订。.agentdev/requirements/README.md为可重建导航索引，不作为导入依据。SQLite中对应字段是可重建投影，本机Work/Task/Run/Plan和完整证据另行保存。

目录示例（<requirement-id>使用真实UUIDv7，展示编号不改变ID）：

```text
.agentdev/
  requirements/                  # Git跟踪
    README.md                    # 自动生成，可重建
    <requirement-id>/
      requirement.json           # 固定字段与正文Hash
      content.md                 # 可直接阅读的详细需求
  work/                          # 本机执行资料，按运行存储规则处理
```

需求完成、取消或归档均留在原目录，保持稳定引用；不按状态搬动文件。不强制每个需求创建Plan、Review或Test文件。requirements目录必须被Git跟踪，不能整体忽略.agentdev而遗漏需求；保存前检查实际ignore规则，受忽略时返回REQUIREMENT_PATH_IGNORED并提示修正规则，不显示已保存。

## 2. 持久字段

PortableRequirement v1是API/数据库读取模型，由以下RequirementMetadata v1（requirement.json内容）加contentMarkdown:string组成；contentMarkdown读取自content.md，不在JSON中重复保存：

```text
schemaVersion: 1
id: UUIDv7                         # 跨服务器保持
version: positive integer
contentFile: content.md             # 固定文件名，不允许任意路径
contentHash: SHA256                 # content.md实际UTF-8字节的Hash
createdAt, updatedAt: UTC time
title, goal: string
scope: Scope
lifecycle: queued | active | completed | cancelled | archived
previousLifecycle?: queued | completed
featureIds: string[]
acceptance: [{id, given, when, then}] # 尚未明确可为空，并列openQuestions
openQuestions: string[]
confirmedDecisions: [{id, summary, decidedAt, sourceKind:user_message|user_action}]
relatedRequirementIds: UUID[]
completion?: {completedAt, summary, codeRevision, codeTree, featureIds, verificationSummary, remainingIssues}
cancellation?: {cancelledAt, reason}
```

所有字段除?外必填；空数组合法。completed以及previousLifecycle=completed的archived必须有completion；cancelled必须有cancellation。codeRevision引用实际已验证代码提交，codeTree是其代码树Hash；需求文件不写自身尚未产生的提交SHA。verificationSummary为事实摘要，不要求迁移完整报告。

confirmedDecisions保存已确认产品结论的可读事实，不携带可执行Grant、Secret或本机权限；新服务器从已有产品意图继续，执行仍需当地授权。Requirement不保存本机projectId/workId/runId、绝对路径、Session、模型密钥和恢复租约。

缺陷候选或未决定想法只有在用户要求保留为需求时写入；保存后即受Git持久保障。独立L1默认仍为内部Work，用户明确“加入需求池”的小事项同样按Requirement保存。

## 3. 保存与更新

创建、目标/验收/状态修改、归档、取消均在用户授权或适用完成Gate后立即提交对应需求文件和索引，不等待代码交付结束。Chief提交结构化命令，Core做字段/版本/授权校验并执行记录事务；此类元数据保存不启动文档开发/Review流程。新的产品语义决定仍按既有规则取得授权。

UI状态saving→saved或save_failed。只有Git文件提交及投影核对成功才显示“已保存”，保存失败保留请求并给重试入口。响应accepted只代表操作已持久接受。显示保存所在分支/提交和未推送提示；远程push仍需有效用户授权。

## 4. 换服务器打开

确认仓库信任后，检测已有requirements目录、读取文件并重建投影；已有知识直接校验/索引，不触发从零调查。优先选择本地agentdev/main；仅有origin/agentdev/main时先建立对应本地分支；都没有时才按当前HEAD建立。其他remote须用户明确选择。依赖尚未配置不影响需求列表的确定性读取。

| Git中的需求状态 | 新服务器显示 | 执行 |
|---|---|---|
| queued | 需求队列，目标/范围/未决项可读 | 用户启动后规划 |
| active | 迭代中需求，标“待继续”，展示已确认目标 | 无本机现场，用户继续后重新规划和验证 |
| completed | 已完成，完成摘要/功能/代码引用 | 可查看；旧报告未迁移显示证据不可用 |
| cancelled | 已归档，标已取消及原因 | 保留终态 |
| archived | 已归档，保留之前状态和摘要 | 按既有规则恢复展示 |

导入不自动创建Run、恢复工具或迁移授权。active导入保留真实历史状态，不伪装Running或静默退回Queued。用户“继续”时以当前仓库和确认目标创建新Work，重新取得环境/执行授权，从Product/Plan第一个未满足的本机Gate开始；旧Task进度不用于放行。

同一id/version/recordHash重复导入无变化；同version不同内容或重复ID报告REQUIREMENT_CONFLICT并只阻断该条。其他有效需求继续可见。缺文件不按空列表静默丢弃：有本机投影但Git记录缺失时标冲突，要求先在Git恢复记录并显式重新导入解除冲突，之后可由用户归档/取消。

## 5. 历史引用与保障边界

PortableRequirement内容和Git路径是跨服务器可读依据。本机消息/Decision/Review/Test详细记录缺失，显示“详细证据未迁移”，不删除需求或否认已记录的交付摘要。重新开发依据当前代码和新的有效验证，不把历史摘要当成本机验证Gate。

功能文档的确认依据可引用.agentdev/requirements/<id>/requirement.json中的confirmedDecisions及同版本content.md；已完成验证可引用completion摘要并标evidenceAvailability=summary_only，保留历史verification状态并明确未经本机重新验证。完整报告存在时为full。找不到任何有效来源才作为知识缺口处理。

本契约保证已保存并包含在用户推送/拉取版本中的需求；未推送提交只在原服务器。多服务器并发编辑通过Git合并，冲突保留双方内容供处理，系统不自动以本机数据库覆盖仓库。

## 6. 正文、版本与引用

content.md采用UTF-8、LF，非空；保存时规范化换行后再计算Hash。正文包含“目标与背景”“范围与行为”“验收说明”“已确认决定”“未决问题”“完成摘要”六个二级标题，各一次，内容为普通Markdown；暂无内容写“无”或“待明确”。completed及从completed归档的需求必须填写实际完成摘要。Markdown中允许具体场景、交互规则和边界说明，不解析自然语言来恢复状态或判定验收通过。

JSON里的goal、scope、acceptance、confirmedDecisions、openQuestions和completion提供简短、结构化的目标、执行边界、验收条目和事实摘要；正文解释这些条目的背景、细节和例子，用验收/决定ID关联，避免整段重复。结构化scope是工具权限上限，正文不能扩大权限。二者有语义冲突时由Chief定位差异、提交同一次修订；不得静默选一份继续开发。无冲突检查结论不影响原文查看，但Product/Plan准入须核对两份当前来源。首次保存允许细节未明确，不能据此假定验收已满足。

UI只提供一个需求编辑/详情入口，同时提交元数据与正文。requirement.json是自动管理的字段，不要求用户手工维护两份内容。title用于列表，正文用于详情；数据库丢失时读取JSON确定列表并直接展示正文，不调用模型提取状态。

每次元数据或正文变化均递增同一个recordVersion，两个文件在同一Git提交发布。portableRef.path指向需求目录；portableRef.hash（也称recordHash）为SHA256对UTF-8字符串“requirement.json\0<metadataHash>\ncontent.md\0<contentHash>\n”求值，metadataHash为实际JSON文件字节Hash，其中\0为单个NUL字节，\n为单个LF字节，尖括号占位替换为64位小写Hash。expectedRecordHash比较此组合Hash，不能只检查JSON或正文之一。SourceRef读取正文或JSON时分别记录文件路径、同一Git Revision及各自Hash；Chief注入需求目标时两者成组加载并计入读取账本。

新服务器逐目录检查目录名=id、Schema、两个必需文件和contentHash；缺任一文件、Hash不一致、重复ID或未知Schema标该条冲突，展示路径及可读原文，不静默补空正文。README缺失或过期只重建本机导航，不能阻断有效需求导入或自动提交仓库。索引按ID排序生成，包含标题、状态和相对正文链接。

当前规范尚无已交付Runtime数据，因此不提供旧单JSON格式的自动迁移；检测到旧位置document-root/requirements/<id>.json时报告LEGACY_REQUIREMENT_FORMAT及路径，要求显式转换并校验后导入，不猜测丢弃或自动覆盖。
