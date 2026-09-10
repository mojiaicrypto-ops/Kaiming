# 持久化、集成与运行恢复

## 1. 接受命令的原子边界

ProjectMailbox只处理短事务：校验身份/版本/幂等→更新领域行→写command response→写event→写outbox→COMMIT→应答。模型调用、Shell、Git、下载和Child等待在事务外异步执行。单事务执行超过100ms记录诊断；耗时IO通过outbox返回结果。

Outbox以operationId至少一次投递；Supervisor先检查已存在的同operationId Runner/结果，避免重复创建。每次Claim设30秒lease，进程重启后重新核对未完成claim；无幂等证明的副作用进入recovery_required。

Project不同Mailbox互不等待。每连接有独立输出队列，软限合并临时输出，硬限关闭该连接；持久事件仍留库。快照读取和订阅建立在同一一致性水位C完成，实时投递只发C后的匹配事件。

## 2. 准入、租约与工具结果

每次Attempt分配递增epoch，签发Capability，持久Starting后启动Runner；ready确认epoch/进程标识/环境后Running。心跳每5秒，20秒无心跳标interrupted，冻结新工具；Supervisor核对进程/容器后撤销Capability并终止旧执行。旧进程未确认终止时不把工作区授予新写者。

所有工具记录prepared→started→finished，保存operationId、输入Hash、目标路径、结果Hash/错误。once Grant的消费与prepared在同一事务保存consumedByOperationId/inputHash；同操作同Hash重取原结果，不重复消费，同操作不同Hash拒绝。已finished的相同operationId返回原结果；started且结果未知的写入不重放。文件原子写可核对目标Hash决定是否完成；外部网络副作用要求查询回执或用户风险处置。

Late事件检查attempt/epoch/expected版本，不覆盖取消、更新后的Plan或新Attempt。拒绝迟到写入结果时仍保存诊断证据。

## 3. 预算与公平调度

Chief槽优先于专业槽，防止子Agent满载时主管无法接收意见。ProjectFIFO按ready_at排队，同优先级轮转；依赖未满足的Task不占Runner槽。默认专业Agent roleConcurrency=2；写入另受Worktree单writer锁。

模型调用前预留input估算+maxOutputTokens，扣除实际usage并释放剩余；未知usage保持预留并标costKnown=false，不能按零收费释放额度。结果最终可查usage再核销。并行调用共享Work预算事务，防止双花。repairUsed达到限制后在下一次返工前Blocked(budget)。预算提高必须用户来源，低于used+reserved的调整拒绝。

## 4. 工作区与集成

无依赖Task从Work baseRevision创建外置Worktree。有依赖Task只有全部前置Done才能启动：Workspace服务在临时树按拓扑顺序纳入祖先Task提交（同层按ID），生成dependencyRevision；Task从该Revision创建，Task、Snapshot和VerificationManifest均记录dependencyRevision及dependencyManifestRefs（已验收祖先的验证Manifest ID）。祖先结果变化使后继Snapshot/结果失效并重建。依赖汇合有冲突时Chief创建独立冲突修复Task，后继保持Blocked(dependency)。正式集成对已经包含祖先的提交只应用各Task相对dependencyRevision的自身Diff，按拓扑顺序，避免重复cherry-pick祖先。写入前确认Plan/租约。开发结束冻结commit和完整代码树（含测试、配置、锁文件；排除正式知识和过程目录），Reviewer/Test读取冻结副本。

单Project集成资源integration:<projectId>互斥。集成步骤：

1. 捕获agentdev/main expectedHead与所有Task结果。
2. 创建integration Worktree，按Task拓扑顺序应用每Task相对其dependencyRevision的自身提交/Diff；同层按Task ID稳定排序。
3. 无冲突得到candidateRevision；有冲突保存Conflict Artifact，Chief派Backend/Frontend修复Task，其结果按对应路线重新验证。
4. 最终组合按route验证：L1/纯文档使用ReviewCheck，L2/L3代码使用独立Review/Test；单Task代码树及语义依据完全一致可复用该路线证据并记录reuse来源。
5. 有Requirement的L2/L3代码由Test执行整体行为验收；L1/纯文档由独立ReviewCheck覆盖目标验收。失败回修复，不把Task Done数量当通过。
6. Settlement修改正式知识候选文件，核对最终代码树与已验证Hash一致。
7. 持久化finalRevision、文档树Hash和已通过证据。
8. CAS更新交付ref：git update-ref refs/heads/agentdev/main <new> <expectedOld>。
9. 核对ref与Artifact后事务写CompletionManifest、Work completed、存在时的Requirement completed及event。

CAS失败表示交付基线改变，保留候选、重新分析并集成，受影响验证重新执行。无Task或纯document路线直接从baseRevision生成文档候选，经过对应Review和结算，沿用相同CAS和恢复步骤。

## 5. 结算一致性

Git与SQLite/Artifact是多资源操作，不共用事务。operation记录每步intent、输入Hash、输出引用及状态。崩溃重启逐步核对：Artifact存在且Hash一致则复用；Git commit存在则复用；ref已指向目标则补记完成；差异不一致阻断recovery。用相同operationId恢复不产生重复完成事件。

Settlement允许更新已证实路径、技术事实、Feature状态；变更产品语义/规则需Decision并回对应Gate。纯文档结算由独立Review执行最终知识Diff、链接和确认来源检查，再由Core完成CAS；该检查为purpose=document_check的独立Review Run，不重新打开代码开发。最终代码树变化才重新代码Review/Test。

对话产物无正式知识提交，产物Hash落盘且必要质量检查完成后Work完成。L1结算仅涉及实际改变文档及索引检查；结果写CompletionManifest，允许requirementId为空。

## 6. 取消和恢复

用户取消：Work cancelling→停止新Dispatch→取消子Run→停止新工具→SIGTERM后10秒SIGKILL工具进程树→核对Git/文件/外部副作用。60秒无法判断则blocked(recovery)，保留Requirement active。安全后cancelled；已交付的先前Requirement不回滚，当前候选保存但不集成。

RecoveryReport={workId,operationId,expectedVersions,runnerState,leases,gitHeads,diffRefs,toolOutcomes,externalEffects,unknowns,recommendedActions,hash}。用户或Core可确定的只读/原子文件恢复不需要新增风险授权；未知副作用处置由用户选resume/accept_cancel/abandon。abandon停止工作但保留unresolved外部影响记录，不能宣称已回滚。

暂停在安全点保存Checkpoint并停Attempt，恢复核对政策、配置、代码、授权和预算。无变化可新Attempt延续；语义基线改变交由Chief重评，过期Review失效。Provider429/5xx等调用未产生工具副作用时2s/8s退避两次，仍失败为Provider阻断；权限拒绝、产品决定、Review/Test失败、Critical故障不使用瞬时重试。

## 7. 启停与部署

agentdev start启动daemon和web；Linux提供systemd单用户服务，macOS提供launchd用户服务。daemon获取每Project文件锁和epoch后加载数据库、迁移、检查outbox/Run；Core存储/Git/迁移检查成功即可提供需求读取；Docker、项目依赖和Provider探测分别影响executionReady，不阻断需求池查看。/healthz.ready表示Core可服务，执行能力由Project快照executionReady和blockers展示。启动BFF不会自己恢复Runner。

优雅停止：停止准入→持久化mailbox/outbox→请求Runner安全停→保存Checkpoint→回收容器/进程→关闭数据库。收到SIGKILL或断电后按恢复流程核对，旧Running不可直接显示继续运行。

CLI命令契约：doctor输出依赖版本/Docker/目录权限/端口状态；start/stop/status；open <path>；backup <projectId> --output <dir>；restore <backupDir> --root <path>；relocate <projectId> --root <path>。失败退出非零并输出error code和operationId；status只读。

远程使用反向代理TLS到BFF，daemon loopback不公开。健康检查/healthz只暴露ready与版本。日志按Project/Work/Run/Attempt/operationId关联，隐藏Secret和敏感用户内容；完整Artifact由受权路径查看。

## 8. 备份与保留

backup将Project暂停到一致检查点，暂停新集成，使用SQLite Online Backup API获取数据库；复制Git bundle（全部AgentDev refs）、本地work、被引用Artifact/Snapshot、无Secret配置和manifest Hash清单；成功后恢复先前非用户暂停工作。操作中断保留临时备份标incomplete，restore拒绝。

restore在目标无活动Project、目录为空或已明确授权替换且已备份时执行；校验清单→恢复Git与文件→恢复SQLite→更新canonical root映射→撤销所有旧租约/capability→标原活动Run interrupted→doctor→显示恢复结果。Provider Secret由单独导入/重新配置，缺凭证时保持provider阻断。

每次发布在固定样例上执行backup→新目录restore→核对知识、证据、Completed与活动恢复状态。用户明确清理日志不能删除任何当前工作或CompletionManifest引用的必需证据。

## 9. Git需求记录提交与导入

requirement.create/update/start/archive/cancel/restore先验证用户来源、期望版本和授权，在SQLite保存requirement_save操作、待写PortableRequirement与command accepted/outbox。读取继续返回最后已提交事实并附saving候选；这时尚未启动代码。Workspace服务在Project集成锁下从当前交付HEAD创建只包含该需求/索引变更的commit，CAS更新agentdev/main，核对文件Hash后提交本机投影/version和requirement.saved。失败标save_failed并保留操作；重试核对operationId/目标Hash，不产生重复需求或重复事件。

仅需求元数据提交不改变代码树或产品语义依据时，活动Task结果可保留；之后集成必须纳入最新requirements目录，避免旧Task删除新需求。代码集成只从Task增量取授权源码，需求文件由Core当前事实维护。完成时Settlement将PortableRequirement.completion、lifecycle=completed与最终知识同一次Git候选提交，随后CompletionManifest绑定该最终Revision；记录中的codeRevision使用已验证候选代码提交，避免自引用SHA。

Clone导入：信任后选择正确交付分支→校验requirements文件→按id/version/hash建立本机投影→active标needs_replan→发布导入摘要。无历史SQLite也能执行。缺本机证据不使历史摘要丢失；明确引用的Git文件缺失/非法记录则逐项冲突。新服务器的local授权、租约、Run均为空；resume由人触发创建新Work。多服务器Git冲突要求显式解决，系统不自动以任意数据库版本覆盖文件。

Git需求即时保存保障本地提交；远程Push仍经授权。UI显示记录所在branch/revision及与remote的同步状态，未推送内容不承诺在新服务器出现。

每个requirement_save持久保存expectedRecordVersion、expectedRecordHash和候选payloadHash；创建使用expectedAbsent=true。取得集成锁后，先将当前HEAD的目标记录与预期值核对，再构建提交；不同或预期不存在却已存在时返回REQUIREMENT_CONFLICT，禁止旧投影覆盖。无关文件/其他需求变化允许从新HEAD重建索引并重试CAS，但目标记录前提不能放宽。完成结算同样逐条核对。若Git已含本操作目标Hash，重试只补投影/事件；尚未提交则保持原前提再尝试，不能跳过版本检查。

需求保存outbox同时持久化完整元数据候选和规范化contentMarkdown；提交必须包含同版本requirement.json/content.md及重建索引，不把工作区暂存的半对文件暴露为已保存。锁内expectedRecordHash、恢复目标Hash均比较目录组合recordHash。完成结算同时更新正文完成摘要和JSON completion；只写其中一份不能完成保存。
