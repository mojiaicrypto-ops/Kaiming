# WP-10 T2 无头端到端演练记录（自动生成）

本文件由 `node scripts/e2e.mjs`（`pnpm test:e2e`）在真实运行后写出，请勿手工编辑。

## 0. 运行元数据

- 生成时间：2026-09-13T16:13:08.443Z
- 命令：`pnpm test:e2e`（实际执行 `node scripts/e2e.mjs`）
- Node：`v24.8.0`
- 仓库：`/Users/huyaohua/huyh/work/aigrouptool`
- Git HEAD：`9917d34cacb910203c59877e2de03ad8690236a4`
- 装载方式：Node 原生类型擦除 + 模块解析钩子直接执行 `packages/*/src`；无构建、无浏览器、无新依赖。
- 真实栈：临时 Git 项目 `/private/var/folders/zs/p0l9stg552j3vgvzwmf0gnp80000gn/T/agentdev-e2e-repo-nT7BkL`、SQLite `/private/var/folders/zs/p0l9stg552j3vgvzwmf0gnp80000gn/T/agentdev-e2e-state-0bWfA2/project.sqlite`、真实 Core 服务、真实 `createDaemon`（HTTP+WS）与真实 `createWebApp` BFF，端口均为回环 0。
- BFF：`http://127.0.0.1:63579`；daemon：`http://127.0.0.1:63578`；允许的 Origin：`http://127.0.0.1:4317`
- Provider：离线演练，未调用任何模型；配置中的 Provider 指向桩地址 `http://127.0.0.1:63577/v1`，模型能力探测（`config.test`）为纯能力校验。
- 检查：PASS 16 / FAIL 0 / UNVERIFIED 4（共 20）
- 退出码：0

## 1. 逐项检查（原始证据）

| 检查 | 状态 | 关联 AC | 证据 |
|---|---|---|---|
| `stack.boot` | **PASS** | AC-078 | daemon 200/BFF 200 healthz; anonymous page 401; /rpc without cookie 401 UNAUTHENTICATED; wrong Origin login 403 NOT_AUTHORIZED; wrong token 401; login 200 with agentdev_web cookie (HttpOnly) + csrfToken; snapshot projectId=469903c41b91889d0db9a7cb4246c71b |
| `auth.lifecycle` | **PASS** | AC-078 | foreign-Origin write 403; logout 200 then cookie 401; daemon session expired (+2h) -> /rpc 401 with the cookie cleared, /api/session 401, Work 01a09b8b-1396-7e46-a3c1-0a9b8aa81339 still running; re-login restored the Chief page |
| `requirement.save-git` | **PASS** | AC-090, AC-093 | requirement 01a09b8b-13d1-70f5-9611-eae77acf0b41 created at 641647dad3f3560df7af2aeeb5d1886942672b65 (branch agentdev/main, unpushed, refUpdated) then updated to recordVersion 2 at 55f8926235ec with a changed recordHash; requirement.json+content.md committed atomically; board identity == requirement id; observation: partial update preserved every body line (true) and re-emitted the record-version marker, contentHash changed |
| `board.rules` | **PASS** | AC-068 | board identity shared (01a09b8b-2079-746b-9807-eddd70990dc8); L1 Work 01a09b8b-26c3-7e7e-a579-2fea6f0a179a excluded and never a card; Queued pause -> 409 INVALID_STATE; Queued cancel -> cancelled at 9c599c07b904588a62de9bfad8cf86ef49f4dafb; branch tip moved |
| `chief.routes-message` | **PASS** | AC-069 | message 01a09b8b-2ffc-7e9c-af30-a5f14d268e36 routed to Work 01a09b8b-2ffc-7507-b315-3d7d31237ed1 (intent=delivery level=L2 authorization=01a09b8b-3016-797e-b952-e105fa52c690); Work.sourceRef is the message; message.received emitted |
| `plan.approval-expired-card` | **PASS** | AC-070 | no-plan refusal (enabled=false reasonCode=no_plan); plan.approve v1 planRef=01a09b8b-3043-789b-8237-dc8edcdc2956; plan.current enabled=true with 1 task(s), authorization=01a09b8b-3016-797e-b952-e105fa52c690; superseded v0 -> VERSION_CONFLICT currentVersion=1 |
| `inbox.decision-dedup` | **PASS** | AC-074 | two same-target decisions collapsed to 1 Inbox row (ids 01a09b8b-305a-7e4a-99d3-587da4611012/01a09b8b-305d-7d7c-9b22-ff6fe4742bd9); expired row actionable=false; resolve -> accepted + idempotent replay; duplicate row untouched |
| `config.validation-preserves-input` | **PASS** | AC-075 | unknownKey -> 422 VALIDATION_ERROR with preservedInput, revision unchanged at 2; reasoning=high saved (rev 3) then config.test -> PROVIDER_UNAVAILABLE with preservedInput; restored to off (rev 4), Settings revision matches |
| `attachment.upload-first-message` | **PASS** | AC-084 | upload 201 attachmentId=01a09b8b-30b7-783a-9013-e0be421d5df4 (staged, installation owner); first message 01a09b8b-30cb-76d9-a8a3-3f9e0c699dde bound it to Work 01a09b8b-30cb-78a9-ac5f-e1137ce4ec73 atomically with 1 user artifact; unsupported mime refused (400) with no residue; duplicate bind -> ATTACHMENT_ALREADY_BOUND |
| `files.branch-preview-boundaries` | **PASS** | AC-077 | revision=422b2f77ab93 branch=agentdev/main, real file content; search found src/orders/cancel.ts; absolute+traversal -> data-code=NOT_FOUND with no leak; snapshots unchanged (1); head advanced to c4e041bd1f9b and the page followed |
| `surfaces.nine-real-state` | **PASS** | AC-068, AC-069, AC-072, AC-074, AC-075, AC-077, AC-038 | 10 surfaces read real state (/projects ok; /projects/469903c41b91889d0db9a7cb4246c71b/chief ok; /projects/469903c41b91889d0db9a7cb4246c71b/requirements ok; /projects/469903c41b91889d0db9a7cb4246c71b/requirements/01a09b8b-13d1-70f5-9611-eae77acf0b41 ok; /projects/469903c41b91889d0db9a7cb4246c71b/docs ok; /projects/469903c41b91889d0db9a7cb4246c71b/files ok; /projects/469903c41b91889d0db9a7cb4246c71b/agents ok; /projects/469903c41b91889d0db9a7cb4246c71b/runs ok; /projects/469903c41b91889d0db9a7cb4246c71b/inbox ok; /settings ok); Live panel modes open/compact/hidden; create/switch control only on the Chief page with the deep link elsewhere; docs delivered/design/work views all real answers |
| `events.watermark-reconnect` | **PASS** | AC-054, AC-060 | hello/subscribe over the BFF /ws; first cursor 15 acked; daemon dropped -> bridge.reconnecting -> bridge.open; the during-break event replayed above the watermark with no duplicate; a fresh socket resumed in mode=replay with nothing at or below 15; Work stayed running |
| `delivery.l2-chain` | **PASS** | AC-010 | Work 01a09b8b-2ffc-7507-b315-3d7d31237ed1 + Requirement 01a09b8b-13d1-70f5-9611-eae77acf0b41 bound; Task 01a09b8b-3718-7919-9a86-00235611b08d; candidate fdfb588539e9 tree 8a5987f24601 codeTree 24573fd9b749; 5 real stage results (Plan/Develop/Review/Test/Settlement) accepted by StageGate; evaluateStageChain(route=code, level=L2) ok with the documented order and refuses a missing Test |
| `delivery.settlement` | **PASS** | AC-010 | CompletionManifest 68b7f6eff873 frozen; settle moved refs/heads/agentdev/main c4e041bd1f9b -> fdfb588539e9; refUpdated=true commitTree=8a5987f24601 codeTree=24573fd9b749; Requirement completed with phase cleared; exactly one settlement.completed event |
| `knowledge.patch-cold-start` | **PASS** | AC-041, AC-037 | knowledge commit 5da2e0cb77f0: document,implementation,verification,verificationEvidenceRefs,verificationCoverage,revision,currentBehaviour,entries,relations,invalidationNotes; projection 5da2e0cb77f0 state=valid (durable SQLite row valid); cold start selected ["F-0f0f0f0f","F-0a1b2c3d"] with "未付款订单可取消；已付款订单返回已确认的拒绝结果。", code+test entries, the constrained_by constraint and the invalidation gap; knowledge.list state=valid |
| `offline.no-model-call` | **PASS** | — | provider stub at http://127.0.0.1:63577/v1 received 0 requests across the whole drill; config.test resolved chief to 01a09b8b-12d4-7389-b73d-f442aa282a83/e2e-offline-model with probe=capabilities-only |
| `browser.rendering-and-isolation` | **UNVERIFIED** | AC-002, AC-052 | AC-002/AC-052 的真实浏览器渲染、脚本隔离与攻击样例需要浏览器环境（无头或真实）；本仓库按产品决定不引入 Playwright 或浏览器下载，因此这两项在本演练中未执行（已提交用例覆盖 CSP/sandbox 预览头、一次性下载 token 与截断） |
| `browser.viewport-and-keyboard` | **UNVERIFIED** | AC-071, AC-073 | AC-071 的 viewport 布局/焦点恢复与 AC-073 的键盘遍历/ARIA 实机朗读需要真实浏览器；本演练验证了三态面板标记与语言字典，未执行像素级与实机键盘检查 |
| `browser.upload-client-hints` | **UNVERIFIED** | AC-076 | AC-076 的服务端拒绝（超类型 mime 无残留引用）已在本演练中执行并作为 attachment.upload-first-message 的证据；客户端提示文案需要浏览器执行，未验证 |
| `provider.fact-and-unknown` | **UNVERIFIED** | AC-001 | AC-001 的“区分事实/未知”需要真实 Provider 纵向演练（pnpm test:live 与 AGENTDEV_PROVIDER_*）；本演练离线运行，Provider 桩被断言零调用 |

## 2. AC 聚合（供 `pnpm test:acceptance` 合并）

| AC | 状态 | 证据 |
|---|---|---|
| AC-001 | **UNVERIFIED** | provider.fact-and-unknown: AC-001 的“区分事实/未知”需要真实 Provider 纵向演练（pnpm test:live 与 AGENTDEV_PROVIDER_*）；本演练离线运行，Provider 桩被断言零调用 |
| AC-002 | **UNVERIFIED** | browser.rendering-and-isolation: AC-002/AC-052 的真实浏览器渲染、脚本隔离与攻击样例需要浏览器环境（无头或真实）；本仓库按产品决定不引入 Playwright 或浏览器下载，因此这两项在本演练中未执行（已提交用例覆盖 CSP/sandbox 预览头、一次性下载 token 与截断） |
| AC-010 | **PASS** | delivery.l2-chain: Work 01a09b8b-2ffc-7507-b315-3d7d31237ed1 + Requirement 01a09b8b-13d1-70f5-9611-eae77acf0b41 bound; Task 01a09b8b-3718-7919-9a86-00235611b08d; candidate fdfb588539e9 tree 8a5987f24601 codeTree 24573fd9b749; 5 real stage results (Plan/Develop/Review/Test/Settlement) accepted by StageGate; evaluateStageChain(route=code, level=L2) ok with the documented order and refuses a missing Test |
| AC-037 | **PASS** | knowledge.patch-cold-start: knowledge commit 5da2e0cb77f0: document,implementation,verification,verificationEvidenceRefs,verificationCoverage,revision,currentBehaviour,entries,relations,invalidationNotes; projection 5da2e0cb77f0 state=valid (durable SQLite row valid); cold start selected ["F-0f0f0f0f","F-0a1b2c3d"] with "未付款订单可取消；已付款订单返回已确认的拒绝结果。", code+test entries, the constrained_by constraint and the invalidation gap; knowledge.list state=valid |
| AC-038 | **PASS** | surfaces.nine-real-state: 10 surfaces read real state (/projects ok; /projects/469903c41b91889d0db9a7cb4246c71b/chief ok; /projects/469903c41b91889d0db9a7cb4246c71b/requirements ok; /projects/469903c41b91889d0db9a7cb4246c71b/requirements/01a09b8b-13d1-70f5-9611-eae77acf0b41 ok; /projects/469903c41b91889d0db9a7cb4246c71b/docs ok; /projects/469903c41b91889d0db9a7cb4246c71b/files ok; /projects/469903c41b91889d0db9a7cb4246c71b/agents ok; /projects/469903c41b91889d0db9a7cb4246c71b/runs ok; /projects/469903c41b91889d0db9a7cb4246c71b/inbox ok; /settings ok); Live panel modes open/compact/hidden; create/switch control only on the Chief page with the deep link elsewhere; docs delivered/design/work views all real answers |
| AC-041 | **PASS** | knowledge.patch-cold-start: knowledge commit 5da2e0cb77f0: document,implementation,verification,verificationEvidenceRefs,verificationCoverage,revision,currentBehaviour,entries,relations,invalidationNotes; projection 5da2e0cb77f0 state=valid (durable SQLite row valid); cold start selected ["F-0f0f0f0f","F-0a1b2c3d"] with "未付款订单可取消；已付款订单返回已确认的拒绝结果。", code+test entries, the constrained_by constraint and the invalidation gap; knowledge.list state=valid |
| AC-052 | **UNVERIFIED** | browser.rendering-and-isolation: AC-002/AC-052 的真实浏览器渲染、脚本隔离与攻击样例需要浏览器环境（无头或真实）；本仓库按产品决定不引入 Playwright 或浏览器下载，因此这两项在本演练中未执行（已提交用例覆盖 CSP/sandbox 预览头、一次性下载 token 与截断） |
| AC-054 | **PASS** | events.watermark-reconnect: hello/subscribe over the BFF /ws; first cursor 15 acked; daemon dropped -> bridge.reconnecting -> bridge.open; the during-break event replayed above the watermark with no duplicate; a fresh socket resumed in mode=replay with nothing at or below 15; Work stayed running |
| AC-060 | **PASS** | events.watermark-reconnect: hello/subscribe over the BFF /ws; first cursor 15 acked; daemon dropped -> bridge.reconnecting -> bridge.open; the during-break event replayed above the watermark with no duplicate; a fresh socket resumed in mode=replay with nothing at or below 15; Work stayed running |
| AC-068 | **PASS** | board.rules: board identity shared (01a09b8b-2079-746b-9807-eddd70990dc8); L1 Work 01a09b8b-26c3-7e7e-a579-2fea6f0a179a excluded and never a card; Queued pause -> 409 INVALID_STATE; Queued cancel -> cancelled at 9c599c07b904588a62de9bfad8cf86ef49f4dafb; branch tip moved |
| AC-069 | **PASS** | chief.routes-message: message 01a09b8b-2ffc-7e9c-af30-a5f14d268e36 routed to Work 01a09b8b-2ffc-7507-b315-3d7d31237ed1 (intent=delivery level=L2 authorization=01a09b8b-3016-797e-b952-e105fa52c690); Work.sourceRef is the message; message.received emitted |
| AC-070 | **PASS** | plan.approval-expired-card: no-plan refusal (enabled=false reasonCode=no_plan); plan.approve v1 planRef=01a09b8b-3043-789b-8237-dc8edcdc2956; plan.current enabled=true with 1 task(s), authorization=01a09b8b-3016-797e-b952-e105fa52c690; superseded v0 -> VERSION_CONFLICT currentVersion=1 |
| AC-071 | **UNVERIFIED** | browser.viewport-and-keyboard: AC-071 的 viewport 布局/焦点恢复与 AC-073 的键盘遍历/ARIA 实机朗读需要真实浏览器；本演练验证了三态面板标记与语言字典，未执行像素级与实机键盘检查 |
| AC-072 | **PASS** | surfaces.nine-real-state: 10 surfaces read real state (/projects ok; /projects/469903c41b91889d0db9a7cb4246c71b/chief ok; /projects/469903c41b91889d0db9a7cb4246c71b/requirements ok; /projects/469903c41b91889d0db9a7cb4246c71b/requirements/01a09b8b-13d1-70f5-9611-eae77acf0b41 ok; /projects/469903c41b91889d0db9a7cb4246c71b/docs ok; /projects/469903c41b91889d0db9a7cb4246c71b/files ok; /projects/469903c41b91889d0db9a7cb4246c71b/agents ok; /projects/469903c41b91889d0db9a7cb4246c71b/runs ok; /projects/469903c41b91889d0db9a7cb4246c71b/inbox ok; /settings ok); Live panel modes open/compact/hidden; create/switch control only on the Chief page with the deep link elsewhere; docs delivered/design/work views all real answers |
| AC-073 | **UNVERIFIED** | browser.viewport-and-keyboard: AC-071 的 viewport 布局/焦点恢复与 AC-073 的键盘遍历/ARIA 实机朗读需要真实浏览器；本演练验证了三态面板标记与语言字典，未执行像素级与实机键盘检查 |
| AC-074 | **PASS** | inbox.decision-dedup: two same-target decisions collapsed to 1 Inbox row (ids 01a09b8b-305a-7e4a-99d3-587da4611012/01a09b8b-305d-7d7c-9b22-ff6fe4742bd9); expired row actionable=false; resolve -> accepted + idempotent replay; duplicate row untouched |
| AC-075 | **PASS** | config.validation-preserves-input: unknownKey -> 422 VALIDATION_ERROR with preservedInput, revision unchanged at 2; reasoning=high saved (rev 3) then config.test -> PROVIDER_UNAVAILABLE with preservedInput; restored to off (rev 4), Settings revision matches |
| AC-076 | **UNVERIFIED** | browser.upload-client-hints: AC-076 的服务端拒绝（超类型 mime 无残留引用）已在本演练中执行并作为 attachment.upload-first-message 的证据；客户端提示文案需要浏览器执行，未验证 |
| AC-077 | **PASS** | files.branch-preview-boundaries: revision=422b2f77ab93 branch=agentdev/main, real file content; search found src/orders/cancel.ts; absolute+traversal -> data-code=NOT_FOUND with no leak; snapshots unchanged (1); head advanced to c4e041bd1f9b and the page followed |
| AC-078 | **PASS** | stack.boot: daemon 200/BFF 200 healthz; anonymous page 401; /rpc without cookie 401 UNAUTHENTICATED; wrong Origin login 403 NOT_AUTHORIZED; wrong token 401; login 200 with agentdev_web cookie (HttpOnly) + csrfToken; snapshot projectId=469903c41b91889d0db9a7cb4246c71b |
| AC-084 | **PASS** | attachment.upload-first-message: upload 201 attachmentId=01a09b8b-30b7-783a-9013-e0be421d5df4 (staged, installation owner); first message 01a09b8b-30cb-76d9-a8a3-3f9e0c699dde bound it to Work 01a09b8b-30cb-78a9-ac5f-e1137ce4ec73 atomically with 1 user artifact; unsupported mime refused (400) with no residue; duplicate bind -> ATTACHMENT_ALREADY_BOUND |
| AC-090 | **PASS** | requirement.save-git: requirement 01a09b8b-13d1-70f5-9611-eae77acf0b41 created at 641647dad3f3560df7af2aeeb5d1886942672b65 (branch agentdev/main, unpushed, refUpdated) then updated to recordVersion 2 at 55f8926235ec with a changed recordHash; requirement.json+content.md committed atomically; board identity == requirement id; observation: partial update preserved every body line (true) and re-emitted the record-version marker, contentHash changed |
| AC-093 | **PASS** | requirement.save-git: requirement 01a09b8b-13d1-70f5-9611-eae77acf0b41 created at 641647dad3f3560df7af2aeeb5d1886942672b65 (branch agentdev/main, unpushed, refUpdated) then updated to recordVersion 2 at 55f8926235ec with a changed recordHash; requirement.json+content.md committed atomically; board identity == requirement id; observation: partial update preserved every body line (true) and re-emitted the record-version marker, contentHash changed |

## 3. UNVERIFIED 与残余

- `browser.rendering-and-isolation`（AC-002, AC-052）：AC-002/AC-052 的真实浏览器渲染、脚本隔离与攻击样例需要浏览器环境（无头或真实）；本仓库按产品决定不引入 Playwright 或浏览器下载，因此这两项在本演练中未执行（已提交用例覆盖 CSP/sandbox 预览头、一次性下载 token 与截断）
- `browser.viewport-and-keyboard`（AC-071, AC-073）：AC-071 的 viewport 布局/焦点恢复与 AC-073 的键盘遍历/ARIA 实机朗读需要真实浏览器；本演练验证了三态面板标记与语言字典，未执行像素级与实机键盘检查
- `browser.upload-client-hints`（AC-076）：AC-076 的服务端拒绝（超类型 mime 无残留引用）已在本演练中执行并作为 attachment.upload-first-message 的证据；客户端提示文案需要浏览器执行，未验证
- `provider.fact-and-unknown`（AC-001）：AC-001 的“区分事实/未知”需要真实 Provider 纵向演练（pnpm test:live 与 AGENTDEV_PROVIDER_*）；本演练离线运行，Provider 桩被断言零调用

- 真实浏览器未执行（焦点遍历、像素级布局、脚本隔离攻击样例）：产品决定不引入 Playwright 或浏览器下载；浏览器级 AC-002/AC-052/AC-071/AC-073/AC-076 在演练报告中标为 UNVERIFIED。
- 真实 Provider 未执行：本演练断言 Provider 桩零调用；AC-001/AC-043/AC-066 的真实模型纵向演练归 `pnpm test:live`（本环境未配置 AGENTDEV_PROVIDER_*）。
- 需求→Work 绑定：产品当前没有“把已保存 Requirement 绑定到 Work”的协议方法（WP-06 车道），演练按 WP-06/WP-08 集成测试的既有做法直接更新真实 row 的 workId/requirementId。
- L2 链的 Task 行由演练直接插入（产品当前没有 Task 创建服务）；Plan 审批、StageGate 阶段结果、Git 候选提交、结算 CAS、知识补丁与冷启动均为真实服务。
- CAS journal 使用 @agentdev/workspace 的内存实现（createMemoryCasJournal），SQLite operation 表由 ProjectStore 承担；崩溃/恢复注入演练不在本切片范围。
- 文件预览读取的是工作树字节，revision/branch 是 Project row 的标签（产品现状，NodeFilePort 即如此）；AC-077 的该行为按产品契约验证，未额外声称 Git 对象读取。
- 观察（未修复，属 WP-06/WP-09 车道）：通过协议对已保存需求做“不含正文的元数据更新”时，提交的 content.md 会再写一次 `<!-- record-version: n -->` 标记（旧标记仍在正文里），因此 contentHash 变化。版本配对与组合 recordHash 仍有效（解析取首个标记），但正文会随每次元数据更新累积标记。演练把该观察写入证据而非断言其不存在。

## 4. 失败原始输出

无失败。

