# 技术架构总览

版本：2.0。产品依据：[产品方案](../product/PRODUCT.md)。实施入口：[交付计划](../delivery/implementation.md)。

## 1. 运行结构

```text
Browser ─HTTPS/WSS→ agentdev-web ─authenticated WS→ agentdevd
                                                    ├ ProjectRuntime A
                                                    ├ ProjectRuntime B
                                                    ├ Model Gateway
                                                    ├ Artifact/Tool Broker
                                                    └ RunnerSupervisor → 独立Runner → Pi Session
本机CLI ──────────────────loopback authenticated WS──┘
```

agentdevd拥有全部业务状态。ProjectRuntime是进程内逻辑隔离，各自拥有SQLite、EventHub和串行短命令Mailbox。Runner承载模型循环与工具调用；Core进程不执行项目Shell。Web只提供静态界面、认证代理和授权Artifact转发。

所有专业Run由Chief DispatchSpec创建；ContextBuilder执行Chief的选择；Workflow验证阶段条件；Supervisor实施准入。系统维护持久的chief_action_required事件，唤起Chief决定后续角色/上下文，不能由流水线偷偷替代Chief分派。

## 2. 仓库包与依赖

| 包 | 责任 | 允许依赖 |
|---|---|---|
| packages/contracts | Schema、枚举、协议、校验 | zod |
| packages/domain | Gate、状态、预算、权限判定 | contracts |
| packages/storage | SQLite迁移、事务、Artifact存储 | contracts、better-sqlite3 |
| packages/knowledge | Markdown解析、索引、Context快照 | contracts、storage |
| packages/workspace | Git、Worktree、租约、集成 | contracts、storage |
| packages/pi-runtime | Pi生命周期、资源与工具桥接 | contracts、Pi SDK |
| packages/core | ProjectRuntime、调度、Broker、配置 | domain/storage/knowledge/workspace |
| apps/daemon | 生命周期、监听、组装Core | core |
| apps/runner | 单Attempt、Pi Adapter、IPC | pi-runtime/contracts |
| apps/web | Fastify BFF、React UI | contracts/client |
| packages/client | WebSocket连接、命令与订阅 | contracts/ws |
| apps/cli | doctor/start/open/backup/restore/relocate/secret/status；安装级凭证与备份维护 | client；core、storage（仅安装级操作 secret/backup/restore/relocate 按需懒加载） |

规范中的路径是待实现路径；现有实现起点见[文档索引](../INDEX.md)。共享Schema一次定义，服务端与客户端共用，测试不复制另一套类型。

## 3. 工具链基线

Node.js 24 LTS，pnpm 12.3.4，TypeScript 7.0.2，React 19.3.0，Vite 8.2.2，Fastify 5.12.3，better-sqlite3 13.0.3，ws 8.21.3，zod 4.5.4，Pi coding-agent/pi-ai 0.85.1，Vitest 5.0.0。浏览器自动化（Playwright 1.63.0）按 WP-10 的已批准偏差（`.agentdev/work/WP-10/plan.md` §2 D1，用户确认）**不引入**：浏览器级证据登记为 UNVERIFIED 并由发布记录逐条列出，真实 Core+BFF+HTTP/WS 的无头端到端由 `pnpm test:e2e` 承担。package.json写精确版本，提交pnpm-lock.yaml；Node最低24.0.0，安装验证选定的24.x补丁并记录doctor输出。

依赖版本在2026-09-10从npm注册信息核对；兼容性由WP-00执行，发现不兼容须通过技术修正记录显式更新依赖和锁文件并重跑契约测试。没有自动latest更新。

Pi采用独立Session Factory、显式ResourceLoader和自定义工具；只在pi-runtime引用SDK类型。Adapter暴露create/prompt/steer/followUp/abort/compact/dispose/subscribe；会话恢复通过保存的SessionManager与新Factory实例，事件订阅每次重新建立。外部API不使用Pi内部字段。

## 4. Project身份与Git

规范化realpath并识别git rev-parse --show-toplevel；同一Git根只打开一个ProjectRuntime。projectId=SHA256(canonicalRoot)前32hex，重定位通过CLI relocate在无活动Run时更新映射并移动状态，保留旧ID别名至重启结束。子目录打开归一为仓库根；嵌套独立仓库必须单独打开，父项目文件读写排除其路径。

每Project使用agentdev/main为交付分支。旧项目首次信任时优先复用本地agentdev/main或从origin/agentdev/main建立本地分支；两者均无时才从当前HEAD创建；若已存在由用户选择继续已有agentdev/main或先显式重新初始化，默认继续已有。原用户工作分支保持不变。脏工作区只读调查可继续；启动交付需先由用户通过AgentDev提交、保存patch或放弃明确路径，禁止自动清理。

所有Task、集成及文档修改在外置Worktree执行，交付分支不在任何可写用户checkout中直接开发。更新ref采用expected old SHA的compare-and-swap。首次空项目创建initial commit后建立交付分支。Worktree路径按Project/Work/Task生成，不接受用户任意路径。

## 5. 配置默认值

| 参数 | 默认 | 范围/语义 |
|---|---|---|
| globalConcurrentRunners | 8 | 1–32；Chief优先预留2个槽 |
| projectConcurrentRunners | 4 | 1–16；同Project至少预留1个Chief槽 |
| roleConcurrency | 2 | 1–8 |
| taskWriterCount | 1 | 固定单写者 |
| workInputOutputTokens | 500000 | 1000–10000000；所有子Run累计 |
| workActiveTimeSec | 7200 | 60–86400；等待用户/权限不计，执行和模型等待计 |
| reviewRepairRounds | 3 | 0–10；同Task失败后再开发计一轮 |
| providerRetries | 2 | 两次重试，退避2s/8s；仅可重试瞬时错误 |
| shellTimeoutSec | 120 | 单操作可授权到1800 |
| heartbeatSec / leaseSec | 5 / 20 | heartbeats超过20s未见转interrupted |
| cancelGraceSec | 10 | 再SIGKILL；总60s仍未知则recovery |
| idleSessionTTLsec | 300 | 保存Checkpoint并退出Runner |
| mailbox | 256项 / 4MiB | 超限返回BUSY，未接受命令可稍后重试 |
| connectionQueue | soft 2MiB / hard 8MiB | 达硬限关闭慢连接，重连同步 |
| requestLimit | 1MiB | 大文件走上传 |
| eventRetention | 30天 | 活动Work关键事件与全部未结算证据持续保留 |

全局配置~/.agentdev/config.toml，Project覆盖.git-root/.agentdev/config.toml。配置写入验证上下界并创建revision；活动Run使用冻结版本。固定常量（如单写者）不能通过覆盖修改。

## 6. 详细技术规范

- [数据与产物](data.md)：持久记录、字段、Schema、权威、版本。
- [协议](protocol.md)：客户端和Runner方法、错误、幂等、事件。
- [Context](context.md)：Chief选择、知识解析、快照、隔离。
- [执行安全](execution.md)：Runner、工具、平台、Secret、测试环境。
- [可靠性](reliability.md)：事务、集成、结算、恢复、部署备份。

外部依据：[Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[Node发行](https://nodejs.org/en/about/previous-releases)、[Git Worktree](https://git-scm.com/docs/git-worktree)、[SQLite备份](https://www.sqlite.org/backup.html)。这些资料解释依赖能力，产品行为由本规范定义。

需求池固定位于Git根目录.agentdev/requirements，元数据与正文成对提交；正式功能文档仍使用documentRoot。本机运行目录与需求池分别制定ignore规则，初始化不得整体忽略.agentdev导致需求未跟踪。详见[需求池规范](../product/requirements.md)。
