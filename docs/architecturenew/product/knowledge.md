# 项目知识与需求

## MEM-01 固定目录及权威

项目文件承载产品与技术事实；Server 保存会话/任务现场。一条需求只有一个 Markdown 文件：头部 YAML 保存结构化元数据，正文保存需求内容，状态只有头部一份权威。需求列表由程序读取文件生成；程序不建第二份 Requirement 生命周期数据库。

```text
AGENTS.md                         项目入口、参数、补充约束
.dev/
  INDEX.md                        导航和读取时机
  PROJECT.md                      定位、能力、当前交付状态与未知
  product/INDEX.md                 产品模块导航
  product/features/<slug>.md       模块行为、验收、实现/验证状态
  technical/INDEX.md               技术职责导航
  technical/<slug>.md              接口、数据、约束、实现事实
  maps/code.md                    代码责任与入口
  maps/tests.md                   检查命令、测试入口与覆盖
  rules/INDEX.md                  项目补充规则索引
  rules/<slug>.md                 仅项目特有规则
  requirements/INDEX.md            格式/查询入口，不手工维护状态列表
  requirements/REQ-<id>.md         一条需求的唯一权威
  work/<taskId>/                   计划、阶段结果、结算与证据
  issues.md                       尚未解决的问题及影响
```

初始化必建 AGENTS 托管段、`.dev/INDEX.md`、PROJECT、product/technical/rules/requirements 的 INDEX。代码/测试地图、issues、模块和 work 在首次需要时生成；没有调查的入口明确写“尚未调查”，不填假路径。

文件名和拆分粒度由 Agent 决定，目录职责固定。当前行为在模块文档完整定义，需求仅说明改变、验收与引用；不得每次需求再复制一份完整产品说明。

## MEM-02 模块化写入

写入前读取 `.dev/INDEX.md` 和相关模块索引，查找已有权威位置。按一项独立用户能力或技术职责划分；只有独立变化/验收/依赖的内容才拆开。跨模块共用事实集中定义，其他文件引用。

模块正文固定为 `## 定义` 和末尾 `## 实现与验证` 两个二级章节，章节内可自主组织。定义写职责/边界、行为或技术约束、验收/依赖与待决；实现与验证写实际代码/测试入口、状态、证据和差距，不能在此隐藏新的行为/约束。状态分开写设计、实际实现、执行验证；“代码存在”不能标记验证通过。AI 依据实际工具与报告写事实，缺证据标未知。

新增、移动、拆分正式知识文档同步更新最近索引；索引包含路径、职责、何时读取，不能复制正文。需求记录由程序按固定目录发现，保存每条需求不要求追加索引条目；只有需求格式或查询入口改变才更新需求索引。文件不存在、引用错误或冲突时先说明/修复，不用全库注入弥补。

## REQ-01 保存讨论

仅“分析/讨论/整理一下”输出讨论内容。明确“保存/加入需求队列”才读取需求规则，生成需求文件并检查需求入口与有效引用；入口缺失时按固定约定补齐，不逐条登记需求列表。保存队列不改正式模块定义；确需正式模块知识整理时，主管按 document 或当前标准交付路线委派专业角色。拟新增模块尚不存在时 productRefs 留空，在正文记拟议归属，不能填无效文件引用。AI 自行发现新需求先提出 action 或文字建议，未获得用户同意不保存。

初次保存使用 [需求模板](templates/requirement.md)：目标、范围/不做什么、行为、验收、来源/决定、未知、完成摘要。信息不足也可保存 queued 草稿，正文列缺口；启动时先由 Product 补齐可执行行为/验收，不能凭缺口进入开发。

ID 为 `REQ-YYYYMMDD-6位随机十六进制`，冲突时重新生成。文件名与 ID 相同，生命周期变化不移动文件。程序解析 YAML 元数据并返回 contentHash；编辑已有需求必须带 expectedHash，冲突返回 FILE_CONFLICT。

## REQ-02 元数据格式与查询

YAML 位于文件首部 `---` 之间；使用成熟 YAML 解析器，关闭自定义标签，再按固定字段 Schema 校验。模板帮助 Agent 编写，格式是否有效由程序判断。必需字段只有以下 7 个：

| 字段 | 格式 |
|---|---|
| format | 整数 1 |
| id | REQ-YYYYMMDD-6位小写十六进制，与文件名一致 |
| title | 非空字符串 |
| status | queued / active / completed / cancelled / archived |
| createdAt、updatedAt | 带时区的 ISO 8601 字符串，updatedAt 不早于 createdAt |
| productRefs | 项目内相对文件路径数组，可为空 |

未知字段只保留不解释；正文必须包含模板的七个二级章节且顺序一致（代码块内文本不算标题），完成摘要唯一并在末尾。YAML 语法错误、重复元数据键、重复 ID、非法必需字段、章节缺失/重复、正文为空或引用不存在属于错误记录。程序只检查字段、模板结构与引用，不判断需求语义是否完整或内聚；后者由 Agent 按规则编写和独立审阅。

读写共用一个需求文件解析/校验函数。通用 write/edit 对需求文件形成完整候选内容后，先校验再原子写入；失败返回 REQUIREMENT_INVALID 和具体字段/章节/引用错误，原文件不变。requirements.get 和引用需求的任务入口同样校验当前文件。bash、外部工具或手工编辑产生的非法文件在查询时报告；通用 read 仍可读取原文和 contentHash，供 Agent 修复，不能因格式错误禁止读取。

列表查询扫描 `.dev/requirements/` 的 `REQ-*.md`，逐文件解析校验，按文件 status 筛选，返回有效 items 与 errors 两组。items 包含 id、title、status、path、updatedAt；不返回需求正文。错误包含 path/code/message，错误记录不进入 items，且不因 status 筛选隐藏错误。列表按 updatedAt 降序再按 id 升序；待实现使用 queued，进行中使用 active，不从正文或聊天推断状态。索引只提供格式和查询入口，不逐条维护实时状态。

第一版每次查询重读目录和文件，无需缓存或文件监听。保存成功后、手动刷新、重新打开和客户端重连时重新查询。读取单条详情返回完整正文、元数据、contentHash 和 Git 状态；格式错误返回 REQUIREMENT_INVALID。没有模型也能查询。主管使用只读 requirements_list 查询待实现列表，再用 read 按需读取选定需求正文；该工具与客户端 requirements.list 共用同一查询函数。

## REQ-03 保存的可观察结果

Agent 用通用 write/edit 按模板保存需求，不另设需求专用写工具。工具先校验候选内容，成功写入后返回路径和 contentHash；Server 发 `project.files_changed` 提醒重新查询。Agent 再读回确认并报告实际结果，不能将聊天文本“成功”当成需求状态。校验失败按错误修正后重试，不创建第二条需求；首次创建失败没有新文件，编辑失败保留原文件。

有 Git 时调用 project_publish，只提交此次明确列出的需求/知识文件，不提交不相关脏改动；无 Git 仍保存同一文件。结果分别显示：已保存本机/已提交 Git/提交失败。Git 失败保留已写文件与重试入口，不能再创建同一需求。未提交 Git 不谎称已进入 Git。

用户在 Git 中已有 staged 内容、目标文件有未经本次拥有的修改或冲突时，publish 返回 GIT_BLOCKED 并保留现场；不得自动 stash/reset。初始化 Git 需用户明确指令，之后可提交此前本机文件。

## REQ-04 启动与生命周期

用户明确启动后，主管创建 task，读取需求并检查缺口，按任务路线执行；标准直接开发请求没有需求文件时，先整理为需求，随后沿原请求继续，不再要求“保存后重新点击开始”。轻量任务无需求文件也可直接执行。

只有 Agent 按规则写文件才改变需求状态：启动有效工作时 queued→active；完成检查成功后由结算将 active→completed；安全取消后写 cancelled 与已有影响；用户归档已结束需求时 completed/cancelled→archived。不通过 task 状态后台自动改写文件。

已结束需求需要新改变时新增需求并引用此前记录；不重开 completed/archived。active 无本机关联 task 时显示“待继续”，不自动恢复权限或运行。暂停 task 不改变 active。

## REQ-05 完成文件与执行现场的边界

结算在适用验证通过后写完成摘要、证据引用及 completed，保存/提交后由主管调用 task_finish。该工具检查流程与文件结果后完成 task。文件与数据库不要求同一事务；中断后保留“完成记录待核对”，按 [恢复规则](settlement.md) 继续完成检查，不重新实施。

completed 文件而本机关联 task 未完成时，列表显示“完成记录待核对”，并保留实际 task 状态；不覆盖文件事实。导入项目只有 completed 文件而无本机 task 时，显示完成摘要和“本机无详细运行记录”。

验收：AC-M01～AC-M07、AC-S02、AC-R04。
