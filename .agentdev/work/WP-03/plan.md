# WP-03 实现 Plan（直接协作与说明产物）

- planVersion: 5
- workId: WP-03
- level: L2（新增 Core 产物/附件/预览模块与 `apps/daemon` HTTP 面；按 `docs/product/experience.md` §3、`docs/architecture/{data,protocol,execution}.md` 既有定义实现，不改产品语义）
- authorization_ref: 用户目标轮次「继续」（2026-09-11）；上级授权为「我要完全实现这个产品，让你来实现」
- productRef: 无独立 Requirement；行为依据为 `docs/delivery/implementation.md` WP-03 与关联 AC（AC-001–006、AC-052、AC-076、AC-084）
- 依赖：WP-02（已完成，结算提交 `f9b61e0`，验证代码树 `cbf7471`）

## 1. goal

让「先解释、再决定是否交付」这条路真实可用：Chief 在不创建 Requirement/Gate 的前提下回答并调查（assist/artifact，`level=none`），按需分派 analysis/artifact 专业 Run（独立 Session、独立 DispatchSpec）；产物落成可版本化的 Artifact（agent 产物绑定 Run、user 产物绑定 Attachment），HTML 说明可隔离预览与一次性下载；附件可先暂存、发送首条消息时原子绑定到新 Work，超限/过期/重复绑定都被显式拒绝；恶意 HTML 在预览路径被隔离策略挡住。真实 Provider 纵向与工具层 `artifact_write` 的执行接线不在本包（WP-10 / WP-07）。

### planVersion 2 变更（授权来源：用户决定「AC-005/AC-006 必须在 WP-03 内完整实现」；2026-09-11）

- 新增 `packages/domain/src/requests.ts`（确定性 Chief 路由：message → work items + 授权判定）与 `packages/core/src/messages.ts`（conversation.message.send 的事务实现）、`packages/core/src/identity.ts` 的 `userIdFromSubject`。
- **判定边界（必须与 Review/Test 对齐的口径）**：`routeMessage` 是模型 Assessment（WP-04/WP-06）之前的确定性基线，按 `docs/rules/workflow.md` §1/§2 的**结构事实**判定（指令子句 = 修改动词 + 命名路径，且不含疑问/拒绝/假设/引用/陈述/完成体标记）。它**不承诺覆盖自然语言的全部表达**：本包采用的语法是**默认拒绝**的——只有当子句本身是「动词 + 单一命名路径」（或 `把/将/对 + 目标 + 动词`）时才授权；未登记的措辞（同义变更词如 `重写/润色/polish`、名词短语祈使如 `修改 X 中的错别字`、轻动词处置式 `对 X 进行修改`、多目标列表 `修改 X、Y`、排除式 `修改 Y 而不是 X`、范围声明 `修改 Y，X 保持不动`）一律落到只读路线并要求澄清。真正语义分类由 WP-04/06 的模型 Assessment 接管；本包的责任是：正向覆盖文档化场景（明确修复/混合意图/拒绝纠正）、负向覆盖已登记的越权语料、并对任何不确定 fail-closed。
- 残余风险的登记见 `implementation.md` T12/T13/T26 与结算材料；Review/Test 应针对「已登记语料 + 边界声明」判定，而不是要求启发式覆盖任意新句式。

### planVersion 5 变更（授权来源：第十九轮 Review 的 P1 修复轮；2026-09-11）

- **解释领起良性改为形状判定（不再用词表）**：`benignExplanation` = 解释领起 **且**（剥离解释领起后剩余部分恰为一个命名路径 **或** 该子句根本不含路径）。
  - 依据：第十八轮用「否定标记表 + 变更动词表」两张枚举表判定，第十九轮证明「未登记否定 × 未登记变更动词」会同时逃过两张表（`说明莫碰 Y`、`解释停止碰 Y`、`说明避免碰 Y`、`说明未碰 Y`、`解释禁止触碰 Y`），并叠加解释领起豁免重开写授权（route 层 216/4290，真实 HTTP 10 句建 10 个写 Run）。
  - 新规则是**形状**判定：解释子句若点名了路径却又夹带任何别的内容（任何措辞的否定、任何措辞的变更、主题短语），剩余部分就不是路径 ⇒ 整条消息只读。不含路径的解释子句没有可夹带的目标，仍可作为混合意图的前导（`explain the routing rules and fix X` 保持授权）。
- **拒绝侧词表合并为一处来源**：`REFUSAL_ADVERBS`/`REFUSAL_CHANGE_VERBS`/`REFUSAL_VERBS_EN` 同时构造 `NEGATION_PATTERNS` 与 `REFUSAL_HEAD_PATTERN`，两者不再可能对「哪些动词算变更」给出不同答案；补入 `重写/优化/完善/清理/整理/替换/纠正/补充` 等，使 `不重写 Y，修改 X` 授权其纠正目标。
- **`则` 归一化**：`ADVERB_LEAD_PATTERN` 补入 `则`，`修改 Y，则修改 X` 与 `修改 Y，也修改 X` 口径一致（两目标均入写范围）。
- **新增 fail-closed 代价**：解释子句中「路径 + 任意附加内容」（`解释 docs/INDEX.md 的原因，然后修改 Y`、`explain the ban on updating Y, then update X`）整条消息只读。
- 计数口径：**187 例 0 偏差**（必须授权 14 / 拒绝纠正接续 10 / 多命令 4 / 必须只读 159，`/tmp/w3r18/probe4-registered.mjs`）。

### planVersion 4 变更（授权来源：第十八轮 Review 的 P1 修复轮；2026-09-11）

- **解释领起子句不再是天然的良性类别**：仅当该子句既**不含否定标记**（`不/别/甭/勿/无需/没有/not/never/without/n't`）又**不点名任何变更**（中英动词，含 `重写/优化/清理/整理/替换` 与英文分词形式 `updating/deleting/changing`）时，才算「显式解释请求」。理由：`说明别改 Y，然后修改 X`、`解释别重写 Y，然后修改 X`、`explain the ban on updating Y, then update X` 里的否定/变更都是**被谈论的对象**，不是用户的请求；把它们当良性会让并列命令获得授权（W3R18-01）。
- **前导礼貌子句不再良性**：只有**末尾**的纯礼貌子句（`修改 X。谢谢`）才被忽略；`谢谢，修改 X` 与 `谢谢，然后修改 X` 现在一致地只读（W3R18-02）。
- **新增 fail-closed 代价**：解释请求中夹带变更叙述（`解释如何修改 Y，然后修改 X`、`explain the plan to update Y, then update X`）整条消息只读并请求澄清；`顺便/顺手修改 X`、`多谢。修改 X` 同样只读。
- 计数口径固定：仓库内路由语料按第十八轮评审计数法（只提取测试文件里 `for (const body of [` / `for (const [body, expected] of [` 块的字面量）实测 **178 例 0 偏差**：必须授权 14、拒绝纠正接续 8、多命令 4、必须只读 152。

### planVersion 3 变更（授权来源：第十七轮 Review 的 P1 修复轮；2026-09-11）

- **拒绝类别改为「子句判定」而不是「关键词命中」**：`refusal` = 该子句命中否定式**且**否定标记在剥离礼貌前缀后**领起**该子句（`REFUSAL_HEAD_PATTERN` 要求标记后紧跟变更动词）。因此 `报告说不要修改 Y`、`文档写着不要修改 Y`、`别人说不要修改 Y`、`说明不要修改 Y`、`在你不要修改 Y 的前提下`、`由于/既然不要修改 Y`、`the report says don't update Y`、`provided/given that you don't update Y` 都不再是「用户拒绝」，而是陈述/前提。
- **未领起的否定 = 陈述 ⇒ 整条消息不授权**：`reportedNegation`（子句含否定式但否定不领起）与既有的标记并集、子句类别规则、首连词片段规则并列，作为第四道抑制。依据：否定在引用/前提中时从不构成用户的拒绝（W3R17-01）。
- **拒绝纠正的口径**（与既有登记语料一致）：
  - 领起拒绝 + 并列连词接续（`不要修改 Y，然后修改 X`、`don't update Y, then update X`）⇒ 授权**接续目标**（登记正例，Review §11.1 #3）；
  - 领起拒绝 + 加性片段（`不要修改 Y，也/顺便修改 X`、`目前不用改 Y，也要更新 X`）⇒ 只读；
  - 领起拒绝 + 逆接连词纠正（`不要修改 Y，但要修复 X`、`别改 Y，改 X`）⇒ 授权纠正目标；
  - 直接否定变更动词的纠正（`不修改 Y，修改 X`、`先别改 Y，改 X`）⇒ 授权纠正目标（W3R17-03 误拒闭合）。
- **逆接连词开头的单句片段**（`但修改 X`、`但是修改 X`、`而是要更新 X`）⇒ 只读，与加性片段口径一致（W3R17-02 闭合）。
- **混合意图允许 `先` 领起解释**：`先解释 X，然后修改 Y` ⇒ assist + delivery 两个 Work，仅 delivery 授权（AC-006，W3R17-03 误拒闭合）。
- **多目标口径（单一规则）**：每个**本身就是命令**的子句都进入同一 delivery Work 的写范围；`修改 X，删除 Y，更新 Z` 三目标全部授权（消除「静默部分授权」）；而「只是路径列表」的子句（`修改 X、Y`、`修改 X and Y`）整个消息只读。旧探针 `/tmp/w3r15` G8-multi、`/tmp/w3r16` K-multi 中「只授权第一个目标」的期望已被本口径取代。
- **已登记的 fail-closed 代价（新增/明确）**：轻动词处置式 `对 X 进行修改`、名词短语祈使 `修改 X 中的错别字`、范围声明 `修改 Y，X 保持不动`、排除式 `修改 Y 而不是 X`、多目标列表 `修改 X、Y`、未登记同义变更词、介词/副词旁置的英文祈使。它们只读并要求澄清，不产生授权。

## 2. scope

writePaths:

- `packages/core/src/artifacts.ts`（新增：Artifact 版本链、创建/失效、ACL、`artifact.created`/`artifact.invalidated`）
- `packages/core/src/attachments.ts`（新增：staged 上传、限制、TTL、原子绑定、删除与过期清理）
- `packages/core/src/preview.ts`（新增：HTML 隔离响应策略、内联截断阈值、60 秒单次下载 token）
- `packages/core/src/index.ts`（导出上述模块）
- `apps/daemon/**`（新增：HTTP 面 `POST /artifacts/upload`、`DELETE /artifacts/uploads/:attachmentId`、`GET /artifacts/:id/preview`、`GET /artifacts/download/:token`、`GET /healthz`，以及 `conversation.message.send` 的 Core 组装）
- `packages/core/test/**`、`apps/daemon/test/**`（新增测试）
- `.agentdev/work/WP-03/**`（过程记录）
- 如发现契约缺口：`packages/contracts/src/entities/{project,system}.ts` 与对应测试（仅补齐，不改既有字段语义）

readPaths: `docs/**`（主要 `product/{PRODUCT,experience,knowledge}.md`、`architecture/{ARCHITECTURE,data,protocol,execution,reliability}.md`、`rules/{workflow,agents}.md`、`delivery/{implementation,acceptance}.md`）、`packages/**`、`apps/**`
不可写：`packages/storage`（除非发现必需缺口，须先记录）、`webui/**`、`docker/**`、`docs/**`（除结算时更新 `docs/INDEX.md`）

## 3. tasks（DAG）

| id | 角色 | goal | dependsOn | acceptanceIds |
|---|---|---|---|---|
| T1 | backend | `core/artifacts`：`ArtifactService`（`createAgent(run, bytes, {kind,mime,acl})`、`createUser(workId, attachment)`、`list/get`、`invalidate`、版本链 `artifactVersion`、blob 写入 + hash 校验、ACL 读取校验、`artifact.created/invalidated` 事件） | — | AC-002, AC-003 |
| T2 | backend | `core/attachments`：`AttachmentService`（stage 校验 mime/单文件/总大小/数量、24h TTL、`expiresAt`、`bind` 原子单次绑定 + `ATTACHMENT_ALREADY_BOUND`、`remove` 仅限 staged、`expireStale`） | — | AC-076, AC-084 |
| T3 | backend | `core/preview`：HTML 隔离策略（sandbox iframe `allow-scripts`、CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'`、预览响应不携带工作台 cookie）、内联阈值（1 MiB / 2000 行，超限截断 + 下载入口）、60 秒单次下载 token（一次性消费、过期 403） | T1 | AC-002, AC-052 |
| T4 | backend | `apps/daemon`：HTTP 面（upload/delete/preview/download/healthz）与 `conversation.message.send` 组装（消息 + 新 Work + 附件原子绑定 + user Artifact；失败保持 staged 可重试） | T1, T2, T3 | AC-002, AC-076, AC-084 |
| T5 | backend | assist/artifact 路由端到端：Chief `assess`（`level=none`）→ 直接回答或分派 analysis/artifact 专业 Run（独立 DispatchSpec/Session）→ 产物汇总；不创建 Requirement/Gate；`none` 级 Work 不产生任何写权限（负例） | T1 | AC-001, AC-003, AC-004, AC-005, AC-006 |
| T6 | backend | 失败测试：恶意 HTML（脚本读 cookie/网络/父页被策略拒绝）、上传限制（数量/大小/mime）、产物生成失败（blob 或 hash 校验失败不留引用）、仅问答无授权写入（`none` 级 Work 派写 Run 被拒） | T1–T5 | AC-052, AC-076 |
| T7 | backend | 独立 Review（fresh context）与修复 | T1–T6 | AC-001–006, AC-052, AC-076, AC-084 |
| T8 | backend | 独立 Test 与结算：`test-report`、`settlement.md`、`docs/INDEX.md` 状态更新 | T7 | 全部 |

## 4. 接口与数据影响

- 新增 `ArtifactService`/`AttachmentService`/`PreviewPolicy`（`@agentdev/core` 导出），使用既有 `artifact`/`attachment`/`snapshot` 表与 `BlobStore`，**不新增表**。
- 新增 `apps/daemon`（HTTP 组装层，Node 内置 `http`，不用新依赖）：监听 loopback，复用 WP-01 的 `AuthService` 校验；只装配 Core，不实现 BFF/WS（WP-04/WP-09）。
- 事件：新增 `artifact.created`、`artifact.invalidated`（`protocol.md` §7 已列）；附件绑定不新增事件名，随 `message.received` 的 data 携带附件引用。
- 协议方法：`artifact.list/get`、`artifact.download.prepare`、`conversation.message.send` 的 Core 侧实现；HTTP 端点按 `protocol.md` §5 第 98 行的形状。

## 5. 验证策略与必需失败测试

- 单元：附件限制矩阵（每消息 5 / 单个 20 MiB / 总 50 MiB / mime 允许集）、TTL 与过期清理、重复绑定 `ATTACHMENT_ALREADY_BOUND`、已绑删除 `INVALID_STATE`；Artifact 版本链与 ACL；预览策略头（CSP/sandbox/无 cookie）、截断阈值、下载 token 单次消费与过期。
- 集成（真实 HTTP，loopback + 真实 SQLite + 真实 blob 文件）：上传 → 发送首条消息 → 新 Work + 附件绑定 + user Artifact；预览端点对恶意样例返回隔离策略；下载 token 二次使用 403；healthz 不泄露路径/Secret。
- 必需失败测试：**恶意 HTML**（读取 cookie/发起网络/访问父页的样例在预览策略下不可达）、**上传限制**（超数量/超大小/错误 mime 客户端与服务端双拒且无残留引用）、**产物生成失败**（blob 写入或 hash 校验失败不留下 Artifact/Attachment 引用）、**仅问答无授权写入**（`level=none` 的 assist Work 不能派发写 Run，也不能写文件）。
- 隔离的验证边界（诚实登记）：本包在 HTTP 响应契约层验证隔离策略（sandbox/CSP/无 cookie/无网络），**真实浏览器执行**的攻防复验属 WP-10 发布回归；无头浏览器不在本包依赖内。
- 退出：WP-03 必验范围通过（解释 + HTML 真实端到端）、无 Requirement/Gate 误创建、代码/Schema/测试/文档入口结算。
