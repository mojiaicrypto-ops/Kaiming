# 角色提示词经验内化结算

日期：2026-10-04。完成范围：九份角色/共同提示词、G4/G5装配/模型检查、I4经验场景及当前导航/验证说明。用户已授权这些经验进入体系；产品行为和工具/运行契约保持原正式定义。

经验进入提示词执行正文；文档组织、代码方法与上下文选择仍由 Agent 自主判断，正式依据按索引读取，必要责任/权限按原契约执行。根 Agent 单独写入，两个干净上下文只读审阅 Passed，见 [review.md](review.md)。

实际文档检查与冻结版本见 [verification.json](verification.json)、[context-snapshot.json](context-snapshot.json)。装配边界静态提取可覆盖经验章节；该检查不是实际宿主注入或模型行为验证。SDK/实际模型/故障/浏览器仍 NOT_RUN；未变化图与协议的既有检查沿用上一轮证据。

当前依据：[基础规则](../../../docs/technicalnew/prompts/base.md)、[Chief](../../../docs/technicalnew/prompts/chief.md)、[设计角色](../../../docs/technicalnew/prompts/designer.md)、[角色与装配](../../../docs/technicalnew/agents-and-tools.md)、[模型检查](../../../docs/technicalnew/implementation-checks.md)。没有新增独立经验手册供模型额外加载；本目录只记录本次工作证据。

源码/代码地图未受本轮文档修改影响，无需编造实现入口。原工程改动与旧文档移动不在本次提交。成果仅按本任务范围 Git 保存，提交由最终回复/Git记录给出，不回填制造第二次提交。

下一步：实现 G4 的实际装配后，用 I4 场景观察工具调用、正式成果、实际证据和干净新会话；据结果修订提示词，不把文档 Passed 当成模型可靠性。
