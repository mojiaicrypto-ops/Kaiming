# 提案与实施需求文件格式

本页是需求文件序列化、版本和格式校验的唯一权威。两类记录的业务含义、状态变化和来源关系见 [需求管理 R-01～R-08](../productnew/modules/requirements.md)；模型工具及访问权限见 [G2 requirement](agents-and-tools.md#requirement)。格式校验不判断目标是否内聚、是否值得实施或是否满足交付。

## F1 文件与共用元数据

每条记录固定保存为 `.dev/requirements/<id>.md`，UTF-8 Markdown，以一个 YAML front matter 开头。不因状态移动文件；id 与文件名一致且创建后不变，kind 不通过原地改类型转换，提案形成实施需求时保存新的关联记录。

```yaml
---
schemaVersion: 2
id: req-example
kind: proposal
title: 待规划目标
status: pending
createdAt: "2026-10-04T00:00:00Z"
updatedAt: "2026-10-04T00:00:00Z"
---
```

必需字段只有 schemaVersion/id/kind/title/status/createdAt/updatedAt。schemaVersion 固定为整数 2；kind 为 proposal 或 implementation；title 为非空字符串。id 为安装内稳定不透明编号，采用安全文件名字符 `[A-Za-z0-9_-]+`，不能以路径、标题相似或正文相等替代身份。时间为 UTC RFC3339 字符串，createdAt 不变，updatedAt 不早于 createdAt。save 保留调用者提供的真实决定内容，以实际保存时间更新 updatedAt。

可选元数据仅按实际需要保存：

| 字段 | 形状与含义 |
|---|---|
| modules | 去重的项目相对 Markdown 路径数组；引用长期权威模块，不表示 Agent 分工 |
| sourceRequirementIds | 去重的既有记录 id 数组；实施需求可引用来源提案/需求，合并与替代的具体关系写正文 |
| linkedTaskIds | 去重的 Task id 数组；设计或实现工作入口，不在文件复制 Task 阶段/状态 |

可选数组缺省为空。用户输入/交互的决定来源与适用产品/技术路径写在正文，服务保存 authorizationRef 的真实回执；不把另一套业务状态、审批类型或聊天全文塞进 front matter。项目相对引用不得越出项目，路径存在性及可读性由保存服务核对；本环境无对应执行记录的 linkedTaskIds 保留并显示缺失，不编造历史或自动启动工作。

## F2 proposal

status 仅为 pending/planning/archived/cancelled；各状态含义和归档条件引用产品 R-05，程序不按 Session 或 Task 数量自动改状态。

正文非空，说明用户意图、来源、已知限制与未知即可，不强制完整实施模板、验收或技术设计。建议使用“目标”“来源与决定”“处理记录”三个二级标题；处理记录按实际填写设计工作、产出需求、合并/不实施结论与已确认依据，尚未处理时如实写明。标题不是格式门禁。

```markdown
## 目标
用户希望解决的问题、限制与尚待规划的部分。

## 来源与决定
真实来源及已明确选择；未知按实际记录。

## 处理记录
尚待规划；后续补充设计工作与产出需求入口。
```

## F3 implementation

status 仅为 pending/in_progress/completed/cancelled/archived；各状态含义和完成条件引用产品 R-04/R-05。

正文按顺序各有一次以下七个二级标题，每节有正文，可用三级标题细分。内容要求引用产品 R-01，不在此重复产品规则。没有未知或尚未实施时明确说明，不以空节伪装已完成。

```markdown
## 目标
## 范围
## 行为与异常
## 验收
## 来源与决定
## 未知
## 完成摘要
```

来源与决定引用实际提案、用户决定及适用产品/技术依据。完成摘要记录真实交付与验证；写出 completed/archived 元数据或摘要不自动完成 Task；关联工作尚未最终收口时按 R-05 显示完成记录待核对，不据文件状态独自宣称整项交付完成。正式需求的实施条件由主管及独立审阅核对，格式正确不表示可实施。

## F4 查询、保存和版本

安全解析 YAML，不执行标签或代码；按 kind 校验必需字段、对应 status、正文形状与引用。重复元数据键、未知 schemaVersion/kind/status、非法路径或实施需求标题缺失/重复/乱序返回可定位的格式错误。不静默猜测未知文件版本或记录类型；保留原文与可定位错误，明确修正后通过 save 保存。

get 返回原文、元数据、实际文件摘要 version（sha256）及引用/格式问题。list 从文件重建，返回 id/kind/title/status/updatedAt、来源/关联摘要及 invalidFiles；按 kind/status 筛选只作用于合法记录，非法文件不会被隐藏。updatedAt 倒序、id 升序，游标绑定过滤条件与排序边界，不手工维护另一份实时状态索引。

save 的 expectedVersion 新建为 null、修改为 get 返回的摘要；同请求重试复用原 requestKey。保存前校验原文件版本、id/kind 不变、格式和实际授权；以同目录临时文件原子替换并读取核对，提交真实版本回执后才成功返回。新建碰撞或旧版本冲突拒绝，失败保留原文；跨存储意图和回执按 [S6](storage-and-recovery.md#s6-文件结果与结算的跨存储顺序)。正式新增、修改及状态保存只能通过 requirement.save，普通 read 可读取，write/edit/脚本不得覆盖需求文件。
