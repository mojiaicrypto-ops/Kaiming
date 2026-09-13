# WP-10 T2 无头端到端演练记录（自动生成）

本文件由 `node scripts/e2e.mjs`（`pnpm test:e2e`）在真实运行后写出，请勿手工编辑。

## 0. 运行元数据

- 生成时间：2026-09-13T13:37:59.775Z
- 命令：`pnpm test:e2e`（实际执行 `node scripts/e2e.mjs`）
- Node：`v24.8.0`
- 仓库：`/Users/huyaohua/huyh/work/aigrouptool`
- Git HEAD：`508bfaf70cdf4368205382200fc82584d78977fd`
- 装载方式：Node 原生类型擦除 + 模块解析钩子直接执行 `packages/*/src`；无构建、无浏览器、无新依赖。
- 真实栈：临时 Git 项目 `/private/var/folders/zs/p0l9stg552j3vgvzwmf0gnp80000gn/T/agentdev-e2e-repo-wJ6G1h`、SQLite `/private/var/folders/zs/p0l9stg552j3vgvzwmf0gnp80000gn/T/agentdev-e2e-state-n0axpC/project.sqlite`、真实 Core 服务、真实 `createDaemon`（HTTP+WS）与真实 `createWebApp` BFF，端口均为回环 0。
- BFF：`http://127.0.0.1:59040`；daemon：`http://127.0.0.1:59039`；允许的 Origin：`http://127.0.0.1:4317`
- Provider：离线演练，未调用任何模型；配置中的 Provider 指向桩地址 `http://127.0.0.1:59038/v1`，模型能力探测（`config.test`）为纯能力校验。
- 检查：PASS 16 / FAIL 0 / UNVERIFIED 4（共 20）
- 退出码：0

## 1. 逐项检查（原始证据）

| 检查 | 状态 | 关联 AC | 证据 |
|---|---|---|---|
| `stack.boot` | **PASS** | AC-078 | daemon 200/BFF 200 healthz; anonymous page 401; /rpc without cookie 401 UNAUTHENTICATED; wrong Origin login 403 NOT_AUTHORIZED; wrong token 401; login 200 with agentdev_web cookie (HttpOnly) + csrfToken; snapshot projectId=c14171f6d34d048d9aec3a2ddc193155 |
| `auth.lifecycle` | **PASS** | AC-078 | foreign-Origin write 403; logout 200 then cookie 401; daemon session expired (+2h) -> /rpc 401 with the cookie cleared, /api/session 401, Work 01a09afd-1f05-7fa2-ab2c-f6cd6cf4dd36 still running; re-login restored the Chief page |
| `requirement.save-git` | **PASS** | AC-090, AC-093 | requirement 01a09afd-1f17-7c36-a9f5-50233f9efc93 created at 251ec1390692c0d0b94bbe24d34806b6eda3baed (branch agentdev/main, unpushed, refUpdated) then updated to recordVersion 2 at 6f95e0cf5d66 with a changed recordHash; requirement.json+content.md committed atomically; board identity == requirement id; observation: partial update preserved every body line (true) and re-emitted the record-version marker, contentHash changed |
| `board.rules` | **PASS** | AC-068 | board identity shared (01a09afd-245d-7dc9-b5d9-bd880eb57aa9); L1 Work 01a09afd-26fe-7bbc-87f9-06a2eabf1b6a excluded and never a card; Queued pause -> 409 INVALID_STATE; Queued cancel -> cancelled at 2a41b2a8897f3177997c3a36a9234402a7624715; branch tip moved |
| `chief.routes-message` | **PASS** | AC-069 | message 01a09afd-2a79-7bfb-9da1-5f2efc762f50 routed to Work 01a09afd-2a79-7ede-9407-a0dc35afb3d2 (intent=delivery level=L2 authorization=01a09afd-2a94-7ff6-bf69-f449575c4bd4); Work.sourceRef is the message; message.received emitted |
| `plan.approval-expired-card` | **PASS** | AC-070 | no-plan refusal (enabled=false reasonCode=no_plan); plan.approve v1 planRef=01a09afd-2aac-7097-a789-49e9a540ba46; plan.current enabled=true with 1 task(s), authorization=01a09afd-2a94-7ff6-bf69-f449575c4bd4; superseded v0 -> VERSION_CONFLICT currentVersion=1 |
| `inbox.decision-dedup` | **PASS** | AC-074 | two same-target decisions collapsed to 1 Inbox row (ids 01a09afd-2ab2-7181-a909-6a72b786475d/01a09afd-2ab2-7539-85fc-bb187c11cb3e); expired row actionable=false; resolve -> accepted + idempotent replay; duplicate row untouched |
| `config.validation-preserves-input` | **PASS** | AC-075 | unknownKey -> 422 VALIDATION_ERROR with preservedInput, revision unchanged at 2; reasoning=high saved (rev 3) then config.test -> PROVIDER_UNAVAILABLE with preservedInput; restored to off (rev 4), Settings revision matches |
| `attachment.upload-first-message` | **PASS** | AC-084 | upload 201 attachmentId=01a09afd-2ac3-74a8-932a-34185be8d088 (staged, installation owner); first message 01a09afd-2ace-732a-8e9f-d076749612fd bound it to Work 01a09afd-2ace-739d-89ef-2f441c168d4c atomically with 1 user artifact; unsupported mime refused (400) with no residue; duplicate bind -> ATTACHMENT_ALREADY_BOUND |
| `files.branch-preview-boundaries` | **PASS** | AC-077 | revision=031d2aa5a715 branch=agentdev/main, real file content; search found src/orders/cancel.ts; absolute+traversal -> data-code=NOT_FOUND with no leak; snapshots unchanged (1); head advanced to d9d640cb7ca8 and the page followed |
| `surfaces.nine-real-state` | **PASS** | AC-068, AC-069, AC-072, AC-074, AC-075, AC-077, AC-038 | 10 surfaces read real state (/projects ok; /projects/c14171f6d34d048d9aec3a2ddc193155/chief ok; /projects/c14171f6d34d048d9aec3a2ddc193155/requirements ok; /projects/c14171f6d34d048d9aec3a2ddc193155/requirements/01a09afd-1f17-7c36-a9f5-50233f9efc93 ok; /projects/c14171f6d34d048d9aec3a2ddc193155/docs ok; /projects/c14171f6d34d048d9aec3a2ddc193155/files ok; /projects/c14171f6d34d048d9aec3a2ddc193155/agents ok; /projects/c14171f6d34d048d9aec3a2ddc193155/runs ok; /projects/c14171f6d34d048d9aec3a2ddc193155/inbox ok; /settings ok); Live panel modes open/compact/hidden; create/switch control only on the Chief page with the deep link elsewhere; docs delivered/design/work views all real answers |
| `events.watermark-reconnect` | **PASS** | AC-054, AC-060 | hello/subscribe over the BFF /ws; first cursor 15 acked; daemon dropped -> bridge.reconnecting -> bridge.open; the during-break event replayed above the watermark with no duplicate; a fresh socket resumed in mode=replay with nothing at or below 15; Work stayed running |
| `delivery.l2-chain` | **PASS** | AC-010 | Work 01a09afd-2a79-7ede-9407-a0dc35afb3d2 + Requirement 01a09afd-1f17-7c36-a9f5-50233f9efc93 bound; Task 01a09afd-2faf-7c54-97a5-45395649282e; candidate 34aa2e86cc56 tree 6f23932d0f9b codeTree 524827c7431e; 5 real stage results (Plan/Develop/Review/Test/Settlement) accepted by StageGate; evaluateStageChain(route=code, level=L2) ok with the documented order and refuses a missing Test |
| `delivery.settlement` | **PASS** | AC-010 | CompletionManifest 42d076b604b9 frozen; settle moved refs/heads/agentdev/main d9d640cb7ca8 -> 34aa2e86cc56; refUpdated=true commitTree=6f23932d0f9b codeTree=524827c7431e; Requirement completed with phase cleared; exactly one settlement.completed event |
| `knowledge.patch-cold-start` | **PASS** | AC-041, AC-037 | knowledge commit 0b5e08953dc7: document,implementation,verification,verificationEvidenceRefs,verificationCoverage,revision,currentBehaviour,entries,relations,invalidationNotes; projection 0b5e08953dc7 state=valid (durable SQLite row valid); cold start selected ["F-0f0f0f0f","F-0a1b2c3d"] with "未付款订单可取消；已付款订单返回已确认的拒绝结果。", code+test entries, the constrained_by constraint and the invalidation gap; knowledge.list state=valid |
| `offline.no-model-call` | **PASS** | — | provider stub at http://127.0.0.1:59038/v1 received 0 requests across the whole drill; config.test resolved chief to 01a09afd-1eba-7983-953f-8bfa0e6bbaa0/e2e-offline-model with probe=capabilities-only |
| `browser.rendering-and-isolation` | **UNVERIFIED** | AC-002, AC-052 | AC-002/AC-052 的真实浏览器渲染、脚本隔离与攻击样例需要浏览器环境（无头或真实）；本仓库按产品决定不引入 Playwright 或浏览器下载，因此这两项在本演练中未执行（已提交用例覆盖 CSP/sandbox 预览头、一次性下载 token 与截断） |
| `browser.viewport-and-keyboard` | **UNVERIFIED** | AC-071, AC-073 | AC-071 的 viewport 布局/焦点恢复与 AC-073 的键盘遍历/ARIA 实机朗读需要真实浏览器；本演练验证了三态面板标记与语言字典，未执行像素级与实机键盘检查 |
| `browser.upload-client-hints` | **UNVERIFIED** | AC-076 | AC-076 的服务端拒绝（超类型 mime 无残留引用）已在本演练中执行并作为 attachment.upload-first-message 的证据；客户端提示文案需要浏览器执行，未验证 |
| `provider.fact-and-unknown` | **UNVERIFIED** | AC-001 | AC-001 的“区分事实/未知”需要真实 Provider 纵向演练（pnpm test:live 与 AGENTDEV_PROVIDER_*）；本演练离线运行，Provider 桩被断言零调用 |

## 2. AC 聚合（供 `pnpm test:acceptance` 合并）

| AC | 状态 | 证据 |
|---|---|---|
| AC-001 | **UNVERIFIED** | provider.fact-and-unknown: AC-001 的“区分事实/未知”需要真实 Provider 纵向演练（pnpm test:live 与 AGENTDEV_PROVIDER_*）；本演练离线运行，Provider 桩被断言零调用 |
| AC-002 | **UNVERIFIED** | browser.rendering-and-isolation: AC-002/AC-052 的真实浏览器渲染、脚本隔离与攻击样例需要浏览器环境（无头或真实）；本仓库按产品决定不引入 Playwright 或浏览器下载，因此这两项在本演练中未执行（已提交用例覆盖 CSP/sandbox 预览头、一次性下载 token 与截断） |
| AC-010 | **PASS** | delivery.l2-chain: Work 01a09afd-2a79-7ede-9407-a0dc35afb3d2 + Requirement 01a09afd-1f17-7c36-a9f5-50233f9efc93 bound; Task 01a09afd-2faf-7c54-97a5-45395649282e; candidate 34aa2e86cc56 tree 6f23932d0f9b codeTree 524827c7431e; 5 real stage results (Plan/Develop/Review/Test/Settlement) accepted by StageGate; evaluateStageChain(route=code, level=L2) ok with the documented order and refuses a missing Test |
| AC-037 | **PASS** | knowledge.patch-cold-start: knowledge commit 0b5e08953dc7: document,implementation,verification,verificationEvidenceRefs,verificationCoverage,revision,currentBehaviour,entries,relations,invalidationNotes; projection 0b5e08953dc7 state=valid (durable SQLite row valid); cold start selected ["F-0f0f0f0f","F-0a1b2c3d"] with "未付款订单可取消；已付款订单返回已确认的拒绝结果。", code+test entries, the constrained_by constraint and the invalidation gap; knowledge.list state=valid |
| AC-038 | **PASS** | surfaces.nine-real-state: 10 surfaces read real state (/projects ok; /projects/c14171f6d34d048d9aec3a2ddc193155/chief ok; /projects/c14171f6d34d048d9aec3a2ddc193155/requirements ok; /projects/c14171f6d34d048d9aec3a2ddc193155/requirements/01a09afd-1f17-7c36-a9f5-50233f9efc93 ok; /projects/c14171f6d34d048d9aec3a2ddc193155/docs ok; /projects/c14171f6d34d048d9aec3a2ddc193155/files ok; /projects/c14171f6d34d048d9aec3a2ddc193155/agents ok; /projects/c14171f6d34d048d9aec3a2ddc193155/runs ok; /projects/c14171f6d34d048d9aec3a2ddc193155/inbox ok; /settings ok); Live panel modes open/compact/hidden; create/switch control only on the Chief page with the deep link elsewhere; docs delivered/design/work views all real answers |
| AC-041 | **PASS** | knowledge.patch-cold-start: knowledge commit 0b5e08953dc7: document,implementation,verification,verificationEvidenceRefs,verificationCoverage,revision,currentBehaviour,entries,relations,invalidationNotes; projection 0b5e08953dc7 state=valid (durable SQLite row valid); cold start selected ["F-0f0f0f0f","F-0a1b2c3d"] with "未付款订单可取消；已付款订单返回已确认的拒绝结果。", code+test entries, the constrained_by constraint and the invalidation gap; knowledge.list state=valid |
| AC-052 | **UNVERIFIED** | browser.rendering-and-isolation: AC-002/AC-052 的真实浏览器渲染、脚本隔离与攻击样例需要浏览器环境（无头或真实）；本仓库按产品决定不引入 Playwright 或浏览器下载，因此这两项在本演练中未执行（已提交用例覆盖 CSP/sandbox 预览头、一次性下载 token 与截断） |
| AC-054 | **PASS** | events.watermark-reconnect: hello/subscribe over the BFF /ws; first cursor 15 acked; daemon dropped -> bridge.reconnecting -> bridge.open; the during-break event replayed above the watermark with no duplicate; a fresh socket resumed in mode=replay with nothing at or below 15; Work stayed running |
| AC-060 | **PASS** | events.watermark-reconnect: hello/subscribe over the BFF /ws; first cursor 15 acked; daemon dropped -> bridge.reconnecting -> bridge.open; the during-break event replayed above the watermark with no duplicate; a fresh socket resumed in mode=replay with nothing at or below 15; Work stayed running |
| AC-068 | **PASS** | board.rules: board identity shared (01a09afd-245d-7dc9-b5d9-bd880eb57aa9); L1 Work 01a09afd-26fe-7bbc-87f9-06a2eabf1b6a excluded and never a card; Queued pause -> 409 INVALID_STATE; Queued cancel -> cancelled at 2a41b2a8897f3177997c3a36a9234402a7624715; branch tip moved |
| AC-069 | **PASS** | chief.routes-message: message 01a09afd-2a79-7bfb-9da1-5f2efc762f50 routed to Work 01a09afd-2a79-7ede-9407-a0dc35afb3d2 (intent=delivery level=L2 authorization=01a09afd-2a94-7ff6-bf69-f449575c4bd4); Work.sourceRef is the message; message.received emitted |
| AC-070 | **PASS** | plan.approval-expired-card: no-plan refusal (enabled=false reasonCode=no_plan); plan.approve v1 planRef=01a09afd-2aac-7097-a789-49e9a540ba46; plan.current enabled=true with 1 task(s), authorization=01a09afd-2a94-7ff6-bf69-f449575c4bd4; superseded v0 -> VERSION_CONFLICT currentVersion=1 |
| AC-071 | **UNVERIFIED** | browser.viewport-and-keyboard: AC-071 的 viewport 布局/焦点恢复与 AC-073 的键盘遍历/ARIA 实机朗读需要真实浏览器；本演练验证了三态面板标记与语言字典，未执行像素级与实机键盘检查 |
| AC-072 | **PASS** | surfaces.nine-real-state: 10 surfaces read real state (/projects ok; /projects/c14171f6d34d048d9aec3a2ddc193155/chief ok; /projects/c14171f6d34d048d9aec3a2ddc193155/requirements ok; /projects/c14171f6d34d048d9aec3a2ddc193155/requirements/01a09afd-1f17-7c36-a9f5-50233f9efc93 ok; /projects/c14171f6d34d048d9aec3a2ddc193155/docs ok; /projects/c14171f6d34d048d9aec3a2ddc193155/files ok; /projects/c14171f6d34d048d9aec3a2ddc193155/agents ok; /projects/c14171f6d34d048d9aec3a2ddc193155/runs ok; /projects/c14171f6d34d048d9aec3a2ddc193155/inbox ok; /settings ok); Live panel modes open/compact/hidden; create/switch control only on the Chief page with the deep link elsewhere; docs delivered/design/work views all real answers |
| AC-073 | **UNVERIFIED** | browser.viewport-and-keyboard: AC-071 的 viewport 布局/焦点恢复与 AC-073 的键盘遍历/ARIA 实机朗读需要真实浏览器；本演练验证了三态面板标记与语言字典，未执行像素级与实机键盘检查 |
| AC-074 | **PASS** | inbox.decision-dedup: two same-target decisions collapsed to 1 Inbox row (ids 01a09afd-2ab2-7181-a909-6a72b786475d/01a09afd-2ab2-7539-85fc-bb187c11cb3e); expired row actionable=false; resolve -> accepted + idempotent replay; duplicate row untouched |
| AC-075 | **PASS** | config.validation-preserves-input: unknownKey -> 422 VALIDATION_ERROR with preservedInput, revision unchanged at 2; reasoning=high saved (rev 3) then config.test -> PROVIDER_UNAVAILABLE with preservedInput; restored to off (rev 4), Settings revision matches |
| AC-076 | **UNVERIFIED** | browser.upload-client-hints: AC-076 的服务端拒绝（超类型 mime 无残留引用）已在本演练中执行并作为 attachment.upload-first-message 的证据；客户端提示文案需要浏览器执行，未验证 |
| AC-077 | **PASS** | files.branch-preview-boundaries: revision=031d2aa5a715 branch=agentdev/main, real file content; search found src/orders/cancel.ts; absolute+traversal -> data-code=NOT_FOUND with no leak; snapshots unchanged (1); head advanced to d9d640cb7ca8 and the page followed |
| AC-078 | **PASS** | stack.boot: daemon 200/BFF 200 healthz; anonymous page 401; /rpc without cookie 401 UNAUTHENTICATED; wrong Origin login 403 NOT_AUTHORIZED; wrong token 401; login 200 with agentdev_web cookie (HttpOnly) + csrfToken; snapshot projectId=c14171f6d34d048d9aec3a2ddc193155 |
| AC-084 | **PASS** | attachment.upload-first-message: upload 201 attachmentId=01a09afd-2ac3-74a8-932a-34185be8d088 (staged, installation owner); first message 01a09afd-2ace-732a-8e9f-d076749612fd bound it to Work 01a09afd-2ace-739d-89ef-2f441c168d4c atomically with 1 user artifact; unsupported mime refused (400) with no residue; duplicate bind -> ATTACHMENT_ALREADY_BOUND |
| AC-090 | **PASS** | requirement.save-git: requirement 01a09afd-1f17-7c36-a9f5-50233f9efc93 created at 251ec1390692c0d0b94bbe24d34806b6eda3baed (branch agentdev/main, unpushed, refUpdated) then updated to recordVersion 2 at 6f95e0cf5d66 with a changed recordHash; requirement.json+content.md committed atomically; board identity == requirement id; observation: partial update preserved every body line (true) and re-emitted the record-version marker, contentHash changed |
| AC-093 | **PASS** | requirement.save-git: requirement 01a09afd-1f17-7c36-a9f5-50233f9efc93 created at 251ec1390692c0d0b94bbe24d34806b6eda3baed (branch agentdev/main, unpushed, refUpdated) then updated to recordVersion 2 at 6f95e0cf5d66 with a changed recordHash; requirement.json+content.md committed atomically; board identity == requirement id; observation: partial update preserved every body line (true) and re-emitted the record-version marker, contentHash changed |

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

