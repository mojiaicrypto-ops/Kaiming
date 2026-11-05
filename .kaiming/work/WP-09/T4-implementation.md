# WP-09 / T4 实现记录：端到端演练与六个必需失败测试

- task: T4（frontend：端到端演练 + 必需失败测试）
- planVersion: 1（`.agentdev/work/WP-09/plan.md`）
- 状态：Developing 完成（等待独立 Review/Test）
- 关联验收：AC-068–AC-078、AC-084、AC-087–AC-090、AC-093（本片声明；AC-071/072/073/074/075/077/078 亦为必需失败测试）
- 依赖：T1–T3 已实现；本片不修改 `apps/daemon/**`、`packages/**`、`apps/web/src|public/**`

## 1. 交付范围（仅两个文件）

| 文件 | 内容 |
|---|---|
| `apps/web/test/workbench.integration.test.ts` | 端到端演练（12 用例）：九个界面读真实状态、Chief 路由、Queued 取消、L1 不入板、过期 Plan、截断产物 + 一次性完整下载、分支预览根边界、Inbox 去重/过期、Provider 失败保留输入、附件首条消息绑定、AC-089 待继续、AC-090/093 保存可见 |
| `apps/web/test/workbench-failures.integration.test.ts` | 六个必需失败测试（7 用例）：持续对话、过期卡片、窄屏焦点、断连、配置失败、订阅扩大（服务端 + 客户端本地拒绝） |

两个文件都启动**真实栈**：真实临时 Git 仓库（`createNodeWorktreeGitPort`）、真实 SQLite `ProjectStore`、真实 Core 服务（含 `RequirementSaveService` + 真实 CAS）、真实 `WorkbenchProtocol`（`/rpc` + RFC6455 `/ws`）与真实 BFF（真实浏览器会话 Cookie），全部绑定 `127.0.0.1:0`，不使用模型调用。

## 2. 工程决定（登记）

1. **T4 需要真实 Git 记录服务**：T3 的 `test/helpers.ts` 未装配 `RequirementSaveService`，因此 Queued 取消与 `requirement.save` 无法完成真实提交。本片在自有测试文件内搭建等价 harness（不修改 `helpers.ts`）：真实仓库 + `createRequirementSaveService({ worktrees: createNodeWorktreeGitPort(), journal: createMemoryCasJournal(), events: createMemoryCasEvents() })`（`cas.ts` 明确允许内存 journal），daemon HTTP/WS 路由按 `apps/daemon/src/server.ts` 的真实路由复刻。
2. **配置在 harness 内种子化**：`ConfigStore` 由 BFF 与协议共用同一实例，真实 Provider/模型先写入，再装配协议，避免“磁盘已写、内存未读”。
3. **浏览器侧行为以“渲染 + 出厂脚本”双重证据**：窄屏焦点与断连的客户端行为由 `public/app.js` 的真实源码断言（`toggle.focus()`、三态循环、`reconnect` 重试、`afterCursor`），不使用产品未采用的无头 DOM。
4. **`workbench-failures.test.ts` 曾因文件名不含 `.integration` 被 unit 项目收集**：已改名为 `workbench-failures.integration.test.ts`，符合“集成测试命名 `*.integration.test.ts`”。

## 3. 测试与证据

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `workbench.integration.test.ts` | 12 | 九界面真实状态；Chief 路由（assessment reason/intent/level + targetWorkId 续接）；Queued 取消的真实拒绝与分支不动；L1 排除；过期 Plan 版本冲突（含 currentVersion）；产物截断 ≤1MiB + 一次性下载消费一次；文件目标 revision/根边界/只读；Inbox 目标+版本去重与过期禁用；Provider 能力拒绝且输入保留、恢复后可用；附件上传→首条消息原子绑定→Artifact→重复绑定拒绝→坏 MIME 无残留；`requirement.continue` 新建 Work 无 Run；`requirement.save` 创建/更新两文件同版本、Git 提交与投影一致、UI 才显示 saved |
| `workbench-failures.integration.test.ts` | 7 | 持续对话（多意图路由、Composer 不锁、seq 递增）；过期卡片（Plan 旧版本 VERSION_CONFLICT 带 currentVersion、过期决定 INVALID_STATE + disabled）；窄屏焦点（三态、顶栏在 Dock 之前、`aria-controls`、关闭回焦、切换不发请求、Run 不变）；断连（`bridge.reconnecting`、水位 replay 无重复、后台 Work 保留、脚本证据）；配置失败（能力拒绝命名 reasoning、输入保留、恢复后 test 通过）；订阅扩大（跨 Project NOT_FOUND 无快照/事件泄漏、未知订阅与非法 kind、同 Project 扩大返回新快照；客户端本地 NOT_AUTHORIZED 且不发请求） |

命令（仓库根、`export PATH="$HOME/.local/bin:$PATH"`）：

```
node_modules/.bin/prettier --write apps/web/test/workbench.integration.test.ts apps/web/test/workbench-failures.integration.test.ts
  → unchanged（两文件均符合 Prettier）
pnpm typecheck   → 退出 0（strict，无错误）
pnpm lint        → 退出 0（ESLint + Prettier check 通过）
pnpm test:unit   → 54 文件 / 1096 用例通过
pnpm build       → 全部 project Done
node_modules/.bin/vitest run --project integration --maxWorkers=4
  → 25 文件 / 296 用例通过（104.14s）
```

**集成并发说明**：默认 worker 数下，本机在连续多次全量集成运行后出现与本片无关的超时（`apps/cli` Docker doctor、`packages/workspace` `git worktree add 失败`、`packages/core` 保存用例 180s 超时）。移除我这两个文件后基线为 23 文件 / 277 用例、100s 全绿；恢复后以 `--maxWorkers=4` 连续两次全绿（含一次 296/296）。结论：这些超时是并行资源竞争，不是本片回归；`--maxWorkers=4` 是稳定运行的命令口径。

## 4. 残余与未越权修改（需其他切片处理）

1. **`requirement.save` 创建时必须省略 `requirementId`**：`apps/daemon/src/protocol.ts` 的 `saveRequirement` 对“新需求 + 传入 requirementId”返回 `NOT_FOUND`（记录不存在），而 `protocol.md` §8 规定 id 由 Core 维护；测试已按文档用 `expectedVersion: 0` 且不传 id。属 T2 协议面语义问题，未修改。
2. **`requirement.save` 的 scope 回退非法**：未传 `patch.scope` 时协议用 `existing.sourceRef` 作为 scope，`sourceRef` 是 `{kind,id,version,path,hash}`，被契约拒绝（`scope: Unrecognized keys`）。测试显式传合法 scope。属 T2。
3. **Queued 取消的正文不合规**：`cancelRequirement` 写入的 `content.md` 只有标题与目标，缺 `requirements.md` §6 的六个二级标题，`RequirementSaveService` 结构校验必然拒绝（`VALIDATION_ERROR`，分支不动）。测试如实断言“拒绝且分支不动”，未伪造成功。属 T2。
4. **`requirement.save` 的 `expected.absent` 未由预期推出**：协议仅在 `patch` 无 contentMarkdown 时校验“新需求需正文”，创建时的 `expectedAbsent` 由内部构造；用过期 `recordVersion` 覆盖保存时守卫读的是补丁而非传入的 `expectedVersion`，因此“同版本异内容”的冲突判定只能靠 manifest/service 自身。属 T2。
5. **`project.subscribe` 越 Project 拒绝的 details 泄漏本机 Project id**：`openProjectId` 出现在 `error.details`（`protocol.md` §1 只要求“跨 Project ID 返回 NOT_FOUND”）。测试断言“无快照/无订阅 id/无事件、message 不含本机 id”，未依赖未定义的字段。属 T2。
6. **Requirement 正文不在投影中**：`requirement` 表无 `contentMarkdown` 列，详情页无法展示正文（页面只有在协议返回该字段时才渲染）。测试改为断言标题/目标与 `data-i18n-project`。属 Core/T2。
7. **`conversation.get` 不返回消息的 `attachmentIds`**：Chief 页的 `data-attachment` 绑定标记因此不出现；测试以“真实绑定行 + 消息正文 + Artifact”证据代替。属 T2。
8. **文件面 revision 标签不随交付分支推进自动更新**：BFF 从 Project 行读 `head`，daemon 保存需求后不更新该行；测试先按真实 Git HEAD 种子化 Project 行，再以更新的 Project 行验证“目标 revision”语义。属 T2/WP-08。
9. **`apps/daemon/**`、`packages/**`、`apps/web/src|public/**`、`test/helpers.ts` 均未修改**；调试期间对 `protocol.ts` 的临时插桩已从备份完全还原（`diff` 为空）。
