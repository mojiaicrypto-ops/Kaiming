# WP-09 / T1 实现记录：`packages/client`（浏览器侧协议客户端）

- task: T1（frontend）
- planVersion: 1（`.agentdev/work/WP-09/plan.md`）
- 状态：Developing 完成（等待独立 Review/Test）
- 关联验收：AC-054、AC-078（另为 AC-055 的同键幂等提供客户端依据，未作为本片声明）

## 1. 交付范围

| 文件 | 内容 |
|---|---|
| `packages/client/src/connection.ts` | `Transport` 接缝、`WebSocketTransport`（Node 内建 `WebSocket`）、`SocketSession`（单连接请求/响应关联）、`ClientError`（协议码原样保留）、`Timers`/`BackoffPolicy`/`backoffDelay`、`closeCodeToError` |
| `packages/client/src/commands.ts` | `ProtocolConnection`（连接状态机 + 有界指数退避 + 写重放）、读写方法表、`WriteReceipt`、`httpCommand`/`httpLogin`/`httpLogout`、Cookie/CSRF/Origin 头构造 |
| `packages/client/src/subscriptions.ts` | `Subscription`/`SubscriptionManager`：快照与回放、水位 `resume(since)`、`batch_end` 水位、`RESYNC_REQUIRED` 重订阅、本地 ACL 拒绝 |
| `packages/client/src/index.ts` | `ProtocolClient`（连接 + 订阅组合）与包出口 |
| `packages/client/test/*` | 5 个测试文件（1 个 `*.integration.test.ts`） |
| 根 `tsconfig.json`、`vitest.config.ts` | `@agentdev/client` paths/alias |

## 2. 工程决定（登记）

1. **不引入新依赖**（无 `ws`、无 React、无 Fastify）：WS 客户端使用 Node 内建 `WebSocket`；测试中的 RFC6455 服务端按 RFC 6455 手写（握手 `Sec-WebSocket-Accept` + 帧编解码），仅存在于测试目录。
2. **TCP 监听不属于本片**：本包只做客户端；真正的 daemon WS 监听端点在 T2（`apps/daemon`）。因此 `project.subscribe` 等命令的响应语义在测试中用 `FakeProtocolServer`（内存双工）与 `WireServer`（真实 socket）实现，避免复制 T2 的职责。
3. `apps/cli` / `apps/web` 可在后续工作包通过 `@agentdev/client` 复用，不需要本片改动其它包。

## 3. 关键行为与依据

- `protocol.md` §1：一个请求一个终结响应；写命令带 `idempotencyKey` + `expectedVersion`；同键同载荷返回原结果。
- `protocol.md` §2：`connection.hello` 永远是每个新 socket 的第一帧；范围改变返回快照，同范围恢复用 cursor；空批次发送 `batch_end` 水位；游标过期 `RESYNC_REQUIRED`。
- `protocol.md` §7：错误码原样透传；仅 `BUSY` 与已知无副作用瞬时错误可重试；未认证/未授权不重试。
- 连接状态机 `connecting → open → reconnecting → … → closed`，退避 `min(maxDelayMs, initial × factor^attempt)`，默认 1s/2s/4s/…/30s。
- 写重试：`BUSY` 退避重试；响应丢失（socket 关闭/超时）时**沿用同一请求 id 与同一幂等键**重放，`WriteReceipt.replayed` 告知调用方该结果是否来自重放。

## 4. 测试与证据

| 文件 | 覆盖 |
|---|---|
| `test/commands.test.ts`（18） | hello 先行、读结果原样、错误码映射、读写参数校验、断线按 1s/2s/4s 退避重连、重连预算耗尽、**同一幂等键重放且 `replayed=true`**、未上线写排队后重放、BUSY 退避重试、AUTH_EXPIRED/NOT_AUTHORIZED 不重试、握手被拒不再重连 |
| `test/subscriptions.test.ts`（14） | 快照订阅与有序事件、`resume` 精确重放水位之后的事件（无重复无缺口）、重复游标丢弃、空批次水位、断线重连按水位补齐、`RESYNC_REQUIRED` 重快照、ACK、范围改变重快照、移除、**跨 Project/越权 kind 本地拒绝且不发请求**、服务端 NOT_FOUND |
| `test/http.test.ts`（11） | Cookie/CSRF/Origin/项目头、401→UNAUTHENTICATED、过期→AUTH_EXPIRED、403→NOT_AUTHORIZED、VERSION_CONFLICT 透传、传输失败可重试 vs 协议不匹配、`/auth/login` 会话与 CSRF 获取、登录被拒单次不重试、Set-Cookie 解析 |
| `test/wire.integration.test.ts`（6，真实 loopback socket） | Origin+Cookie 握手与命令往返、事件帧按 cursor 有序、错误 Cookie 被 403 拒绝、完整 `ProtocolClient` 真实 socket 订阅 + `afterCursor` 恢复、会话过期 AUTH_EXPIRED 且不再重连、非法 URL 直接拒绝 |
| `test/helpers.ts` | 内存双工 `FakeTransport`、`FakeProtocolServer`、可推进的 `TestClock`（非测试文件，作为共享测试夹具） |

## 5. 残余与未做

- `subscribe()` 在连接尚未 open 时抛 `TRANSPORT_CLOSED`（不排队）；调用方需在 `connect()` 或 `waitUntilOpen()` 之后订阅。
- 每请求超时使用注入 `Timers`（默认 30s）；测试夹具设为 60s 以免干扰退避断言。
- 未实现 daemon 侧 WS 监听（T2）与 BFF 页面（T3）。
- `apps/cli`、`apps/web` 未改动。
