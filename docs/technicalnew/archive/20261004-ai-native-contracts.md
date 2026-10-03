# 2026-10-04 技术契约设计交付记录

## Plan

- 目标：从总图和协作、恢复子图落实可供独立 AI 实现的链路契约；覆盖持久输入、Pi 接入、角色/工具/上下文、并行分工、停止与崩溃恢复。
- 授权：用户本轮明确要求编写；Review 在 Test 前、主管异步协调已由用户确认。只改设计文档与导航，不实施业务代码，不修改外部 skill。
- 依据：docs/productnew/README.md、modules/{delivery,chief-conversation,requirements,project-workspace,project-knowledge}.md、acceptance.md，以及本轮前 docs/technicalnew 三份设计。
- 排除：旧业务代码、docs/old、docs/architecturenew、历史聊天全文。工作区已有代码修改与旧文档迁移不属于本次交付。
- 顺序：核对产品与固定版本主源 → 总图与子图 → 各链路的字段/算法/错误 → 内置角色规则 → 独立开发者审阅 → 文档静态核对 → 更新导航与结算提交。
- 文档范围：technicalnew/README、architecture、runtime-contract、messaging-and-collaboration；新增 storage-and-recovery、agents-and-tools、implementation-checks、prompts；修正新设计入口。产品只澄清用户已确认的阶段顺序。
- 检查：局部引用、Mermaid 语法、JSON 示例、工具目录与提示词一致性、产品/技术归属、未验证 SDK 能力不伪装已实现。运行与模型行为试验均保持 NOT_RUN。
- Review：独立、只读上下文；不读取作者开发聊天。阻断项修复后复审。

## 主源研究

独立 reference_contract_audit 只读核对 Pi v1.0.0（a13d35a742c6ef8462812a28fbe1d8c8b7431c32）、OMP（9348320cc4a30a7195d36a1f05a6c11bcb701a17）与同一 Pi commit 下 Durable。未执行 SDK 接入或故障试验。

- Pi 提供指定 SessionManager、显式资源、工具和取消接口；open 缺文件/空文件会初始化，宿主须先检查。
- 公共 subscribe 回调不被 await；message_end 广播在 appendMessage 前，不能作为提交确认。
- appendCustomEntry 可用于输入标记候选；扩展 pi.on("turn_end") 可提供已追加条目 ID，公开 subscribe 的同名事件不提供；均需针对压缩、分支与写失败试验。
- appendMessage 接受 ToolResultMessage，属于公开恢复候选；配对/重复补写/接续没有跨存储保证，未经试验采用上下文交接。
- execute/hook 抛错可能变成错误结果继续运行；关键工具顺序执行、宿主关闭准入、ctx.abort 和外层等待 idle 必须联合验证。
- OMP 可参考独立角色、工具/配置恢复、稳定身份及结果归属；其内存投递不替代 SQLite 持久输入。
- Durable 可参考稳定请求与提交边界，采用 pi-ai + Chord 的独立 Harness，不是 coding-agent 的替换插件。

## 交付与 Review

交付内容：重写 README、执行总图、运行契约和消息协作；新增存储/恢复、角色/六个领域工具、实施检查和三个内置规则文件。导航更新 docs/INDEX.md、AGENTS.md。产品 delivery 仅补充用户已确认的“同阶段并行 Review，之后 Test”和“主管回复结束不终止异步 Task”，未从技术设计增加产品规则。

独立上下文：technical_developer_review 只读当前产品与技术文档，不读取作者聊天、旧代码、old 或 archive；reference_contract_audit 从固定主源核对 Pi/OMP/Durable，并只读技术契约。两者未修改文档。

| 审阅 | 首轮发现与修复 | 最终结果 |
|---|---|---|
| 开发者冷读 | 目标/范围修订缺入口、初始化写授权缺应用链、Plan/返工/停止转换不足、Task 暂停可能阻断主管、候选复制竞态、结算缺结构化清单；补齐对应操作、版本与预约、类型/核对。后续发现 Task 控制通知强制源输入，改为按 code 校验 | Review Passed；可进入实施 Plan |
| 固定主源核对 | 原输入缺根条目不能证明未执行；增加任何 Pi 投递前必须保存的 deliveryIntent。区分扩展 turn_end 与公开订阅事件 | Review Passed；没有承诺未验证的透明恢复 |

## 文档检查证据

| 检查 | 方法与观察 | 结果 |
|---|---|---|
| 当前入口/产品/技术本地引用 | Python 临时检查器读取 20 个当前 Markdown；95 个本地文件/锚点引用，0 缺失 | Passed |
| 协议 JSON | 同检查器逐个 json.loads；4 个 JSON 示例，0 错误 | Passed |
| 流程图语法 | 临时目录 mermaid@11.12.0 + jsdom@26.1.0，mermaid.parse；7 图，0 错误。未改变仓库依赖 | Passed |
| TypeScript 结构 | 两个代码块合并临时文件，仓库 tsc --ignoreConfig --noEmit --strict --skipLibCheck --target es2022；退出 0 | Passed |
| 工具目录 | 六个工具标题与 task/agent_delegate/agent_send/agent_report/requirement/decision 完全一致；独立审阅核对角色和消费规则 | Passed |
| 修改格式 | git diff --check，仅检查本轮入口/产品澄清/technicalnew；退出 0 | Passed |
| SDK、模型行为、崩溃、UI 与产品验收 | 未实施新业务代码，未执行 PI/REL 场景或浏览器运行检查 | NOT_RUN |

TypeScript 初次命令因当前编译器要求显式跳过根配置返回 TS5112；增加 --ignoreConfig 后通过，没有改变项目配置。图表完成语法检查，本轮未做 HTML 图表生成或视觉验收。

## 结算与下一入口

本轮没有改变业务代码、依赖或用户已有修改；旧文档迁移不纳入提交。仅提交本记录列出的设计和导航。提交身份由 Git 历史及交付回复提供，不在同一提交的正文里制造哈希自引用。

实施入口是 ../implementation-checks.md 的 P0/P1：先证明 Pi 最小接入边界，纯存储可独立推进。PI-03 不通过时首版用已规定的 handoff；关键可靠性试验未通过不能宣称运行链路已完成。后续实施产生的代码地图、真实命令和产品验收结果另行结算，当前文档不编造。
