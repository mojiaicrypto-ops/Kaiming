# 产品知识规范

## 1. 知识层次

| 层次 | 文件 | 内容 |
|---|---|---|
| 总览 | docs/agentdev/PROJECT.md | 用户、目标、边界、主要模块及导航 |
| 索引 | INDEX.md、CODE_MAP.md、features/README.md | 能力和路径定位 |
| 功能 | features/<feature-id>/README.md | 当前行为、设计/实现/验证、关联、差距 |
| 约束 | rules/、architecture/、testing/ | 共用规则、接口和验证方法 |
| 需求事实 | .agentdev/requirements/<id>/{requirement.json,content.md}、README.md | 未实现需求、状态、目标/验收及完成摘要，Git管理 |
| 执行 | .agentdev/work/<work-id>/ | 当前需求/任务、Plan、Review/Test/Settlement |

一个Feature可被多个需求改变，一次Requirement可影响多个Feature。模块是组织和导航标签，Task按可独立执行验证的边界拆分。

## 2. Feature格式

每个Feature使用[Context实现的规范Markdown格式](../architecture/context.md)，固定字段表和标题由系统生成并校验。下列说明定义字段语义，准确键名/多值/空值与必填条件以该格式为准。

- 标识：feature_id（F-加8位随机十六进制）、名称、module、owner_document。
- 用途：用户、解决的问题、可观察结果。
- 设计：unconfirmed/confirmed/retired、确认决定引用。
- 实现：absent/partial/implemented/removed、基准Git revision。
- 验证：unverified/partial/passed/failed、证据引用与覆盖范围。
- 调查：unexplored/partial/investigated、调查范围和来源。
- 当前行为：输入、前置条件、正常/异常输出、约束。
- 关系：target_feature_id、kind=depends_on/shared_data/constrained_by/affects、reason。
- 实现入口：repo-relative代码/测试路径及可选符号。
- 已知差距：描述、影响、来源、处理状态。
- 关键决定：决定引用及仍影响当前工作的理由。

关系目标未调查时创建最小Feature占位并标unexplored；禁止虚构行为。文档只在最近权威位置完整定义事实，索引给一句话摘要及链接。文件大小超过24KiB时按接口/行为/测试拆分并保留主入口。

## 3. 事实与生效

设计表达已确认意图；代码和运行证据表达实际行为。两者冲突记录差距。调查推断标注来源和不确定，不自动视为用户意图。

用户确认的项目设计可以通过document Work提交到正式文档，保持相应实现状态。正在开发的需求行为以Work下ProductDefinition覆盖层保存，查询时展示“当前已交付”与“本需求已确认目标”；正式功能现状在结算时更新。纯讨论只保留对话。查询当前实现默认使用交付分支HEAD与其正式文档。

历史需求以引用追溯；功能正文提供当前完整行为。移除功能保留retired/removed入口及必要兼容说明。

## 4. 新项目初始化

Create建立目录、单Git和默认交付分支agentdev/main（空仓库使用无产品文件的初始提交）；code-root=code，document-root=docs/agentdev。Chief先讨论目标，Product Agent依用户确认写产品与功能文件。未知项显式列出。代码写入须经过分级授权。

## 5. 旧项目初始化

Open识别realpath、Git根及现有文档；code-root=.，代码范围排除document-root。用户标记信任后可扫描。阶段为Identifying→Mapping→Confirming→Writing→Ready；缺权限/意图为Blocked，失败为Failed，可按已保存Artifact继续。

读取预算默认最多40个正文文件、总512KiB；一级目录/文件名索引不计正文数量但最多10000条并分页。排除.git、依赖目录、生成物和二进制。按README、Manifest、构建测试入口、相关路由/模型依次选择。达到预算输出部分地图和未知，不声称全量理解。Chief可申请下一批有理由的范围内调查。

写入最小PROJECT、INDEX、CODE_MAP、features/README；必要功能条目带代码/文档/测试来源。初始化产品意图推断由用户确认，纯路径及观察事实可写为observed。现有正式文件生成Diff而非无条件覆盖。发现Bug只记录候选；明确修复授权才创建交付。

无Git目录支持调查和Artifact；正式文件交付先经用户同意初始化Git。入口检查或缺少知识不阻止对具体问题进行只读调查。

## 6. 知识维护

Product提供行为，Planning提供影响集合，Developer提供实际Diff与入口，Review检查一致性，Test提供验证，Settlement执行更新。每个被改变/移除的功能、路径、关系都需要更新或记录无影响理由。

结算维护当前事实和索引，执行历史留在Work目录。纯错字修改无需重写全部知识；记录涉及文档和检查结果即可。链接失效和重复事实应修复，未解决缺陷进入功能已知差距。新会话仅凭入口能够定位此次变化是结算必要检查。

## 7. 可迁移需求

需求定义、生命周期及完成摘要按[需求池规则](requirements.md)即时保存到Git；执行目录仅存Plan/Task和详细报告。已有需求知识随Clone读取，本地证据缺失仅影响证据可用性，不阻断需求列表及有来源的产品理解。
