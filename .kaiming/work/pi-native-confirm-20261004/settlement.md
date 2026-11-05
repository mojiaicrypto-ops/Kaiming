# Pi 原生确认决策 · 文档结算

日期：2026-10-04。用户已确认沿用 Pi 原生交互模式，并要求更新提示词和产品文档。仅文档修改，未改运行代码、工具 Schema 或基础/专业角色提示词。

## 结果

Chief v2 删除 plan.confirm 及 interaction request/present/wait/resolve/invalidate 操作链，保留何时需要决定、问题内容、真实答复与继续/拒绝规则。Task 核心调用、阶段记录与原批次等待仍保留。

主管对话 C-05 定义确认/选择/输入沿用 Pi 原生语义，无业务确认分类。子 Session 经主管协作通道呈现，宿主处理关联、转发、记录和恢复，不要求模型逐个呈现或再次批准，不要求用户订阅所有子 Session。

答复先恢复原扩展/工具；需要模型判断时经实际执行结果返回，不假定自动追加普通 user 消息。文字答复必须明确关联原请求，普通聊天不替代悬挂请求响应。去重、旧内容失效、停止/取消、断线恢复和不重复工作保持。

同步总览、用户流程、任务交付和 AC-12/AC-20；34 个验收编号保留。入口标明原工具/消息/存储契约及基础/专业规则仍待同步，不能按旧 interaction 协议直接实施最新规则。

## 主源核对

- [Pi v1.0.0 RPC 实现](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/src/modes/rpc/rpc-mode.ts)：内存 Map 保存待答复 Promise；confirm/select/input 产生原生请求，响应 ID 对应原等待，返回 boolean 或字符串/取消值。
- [Pi 官方扩展示例](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/examples/extensions/rpc-demo.ts)：ctx.ui 答复返回发起调用的扩展，再继续原操作。
- 核对使用本地研究副本及官方源码；不据此声称 SDK 已自动接入 RPC、持久化或恢复，这些是宿主后续实现职责。

## Review 与检查

独立只读 reviewer：/root/native_confirmation_review。最终 ReviewPassed，无阻断；核对当前提示词、产品 diff、入口待同步标记与 Pi 原生源码，不读作者聊天，不改文件。

实际检查：
- `node /tmp/agentdev-doc-check.C8cqSd/current-docs.mjs`：通过，21 Markdown、110 本地链接/锚点，无错误。
- 专项文本/标识检查：通过。Chief 无 interaction(op=) 与 plan.confirm；产品无业务确认类型与旧主管模型逐个呈现规则；六项主要 Task/需求工具、恢复/去重/失效/停止保障仍在；AC-01～AC-34 唯一且连续。
- `git diff --check`（本轮路径）：通过。
- 模型、SDK、浏览器、故障与产品运行验收：NOT_RUN。

## 后续与保存

技术同步需具体核实取消后的迟到答复、重启后重复提交已解决答复等场景；产品已经要求相应保障，本轮不宣称已验证。其他需求/设计角色相关待同步事项保留。

索引及技术入口更新；业务代码和代码地图无影响，未改 AGENTS、skill 或项目规则文件。本轮成果与记录独立提交，用户其他代码改动、历史文档迁移和未跟踪文件保持原状。
