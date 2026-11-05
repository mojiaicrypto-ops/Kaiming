# WP-12 T1.1 实现记录（凭证入口：持久化仓库 + 协议命令 + CLI）

- planVersion: 1（`.agentdev/work/WP-12/plan.md`，决定 D2/D3/D4）
- 依赖：WP-00～WP-11（基线 `7c723ec`）
- 范围：只做 T1 的第一刀——**持久化 Secret 仓库**、**启动装载**、**`secret.set/delete/list` 协议命令**、**daemon admin `/secret` 面**、**`agentdev secret` CLI**、**诚实的 `secretConfigured`**。
- 明确不在本刀：WebUI 设置页 API Key 输入与「测试连接」（T1 ④，留给 UI 切片 T4）、`config.save` provider `secretRef` 联动校验（T1 ⑤）。D2/D3/D4 不变：Provider Secret 只对 `gateway` audience 生效、注册 ≠ 授权、不新增第 11 条工程命令。

## 1. 逐文件变更

### `packages/core/src/secret-repository.ts`（新增，核心交付）

`docs/architecture/execution.md` §4「Store在macOS使用Keychain，Linux使用0600加密文件，密钥由安装时生成的0600独立主密钥文件或系统credential提供」与 `docs/architecture/reliability.md` §7 的安装家目录（`~/.agentdev`，`AGENTDEV_HOME` 可覆盖）是依据。两个后端同一接口：

- **file**：`<home>/secrets/`（0700）下 `master.key`（0600，32 字节随机主密钥 base64）与逐 ref 的密文记录 `<sha256(ref)>.json`（0600，AES-256-GCM，12 字节随机 IV，ref 作为 AAD 绑定，`iv/tag/ciphertext` base64）。主密钥与密文都复用 `packages/core/src/runtime.ts` 的原子 0600 写（`writePrivateFile`），主密钥用 `O_CREAT|O_EXCL` 建，两个守护同时首启不会各装一把钥匙。文件头（`ref/audience/updatedAt/algorithm`）是明文元数据，`list()` 只读它，不解密。
- **keychain**：`/usr/bin/security add-generic-password … -U | find-generic-password -w | delete-generic-password`，service=`agentdev-secret`、account=ref；命令 runner 可注入，测试用内存假 Keychain，**绝不碰真实 Keychain**。值只在 Keychain，`<home>/secrets/keychain.json`（0600）只存 ref/audience/updatedAt 索引。`find` 退出码 44（errSecItemNotFound）判为「不存在」，其他非 0 抛 `SECRET_KEYCHAIN_FAILED`。
- **选择**：`AGENTDEV_SECRET_BACKEND`（`file` | `keychain`）；未知值报 `SECRET_BACKEND_INVALID`（不静默回退）；未设置时 darwin 且 `security` 可用取 keychain，否则 file。
- **错误**：`SecretRepositoryError`（typed code）。主密钥缺失=`SECRET_MASTER_KEY_MISSING`、长度不对=`SECRET_MASTER_KEY_INVALID`、GCM tag 校验失败=`SECRET_DECRYPT_FAILED`——**不返回垃圾值、不猜测**。所有错误消息最多含 ref，绝不含值。

### `packages/core/src/secrets.ts`

- 新增 `isValidSecretRef(ref)`（复用原 `REF_PATTERN`/长度常量），供仓库与 CLI 在落盘前拒绝非法 ref。
- `SecretStore` 新增 `remove(ref): boolean`（删除注册）。**`resolve` 策略一行未改**，WP-07 授权语义不变。

### `packages/core/src/runtime.ts`

- 原模块私有 `writePrivateFile` 改为导出（JSDoc 注明 WP-12 T1.1 复用 0600/原子写），实现不变。

### `packages/core/src/index.ts`

- `export * from './secret-repository.js';`

### `apps/daemon/src/main.ts`

- `startRuntime` 创建 `secretRepository = createSecretRepository({home, backend: options.secretBackend})`，再用 `loadSecretsIntoStore()` 装入 `const secrets = new SecretStore()`——**在执行栈构建之前**，所以已注册 Provider 凭证第一次调用就可被 `gateway` audience 解析。装载失败逐条 `log` 出 `ref + code + message`（响亮但不阻断 UI 启动；缺失的 Provider 之后诚实报 `secretConfigured:false` 并失败关闭）。
- `RunningRuntime` 新增 `secrets`、`secretRepository`；`openProject` 透传二者。
- admin 面新增 `POST /secret`（`{ref,value,audience?}`）与 `DELETE /secret`（`{ref}`）：仍是安装凭证 Bearer + 仅回环；POST 非法 JSON 用**固定消息**（不引用解析器可能带出 body 片段的原始信息），失败消息过 `redact(message,[value])`；成功只回 `{ref,configured,updatedAt,backend}`。
- 新增测试缝 `StartRuntimeOptions.secretBackend`（测试固定 `file`，不碰真实 Keychain）。

### `apps/daemon/src/bootstrap.ts`

- `OpenProjectOptions` 新增可选 `secrets` / `secretRepository`，透传给 `WorkbenchProtocol`。

### `apps/daemon/src/protocol.ts`

- `WorkbenchServices` 新增可选 `secrets`、`secretRepository`（未接线时 secret 方法按既有惯例拒绝：`INVALID_STATE`）。
- `GLOBAL_METHODS` 增 `secret.set/delete/list`（无 Project scope）；`WRITE_METHODS` 增 `secret.set/delete`；`NON_TRANSACTIONAL_LEDGER_METHODS` 增二者——效果写到文件/Keychain，不能与项目 SQLite 账本同事务（与 backup/restore 同理），账本只记响应元数据。
- 分发新增三支；处理器先 `requireInstallationCaller`（`subject === 'installation:local'`，否则 `NOT_AUTHORIZED`）：
  - `secret.set {ref,value,audience=gateway}`：`repository.set()` + `store.put()`（同一 audience），返回 `{status:'applied',ref,configured,updatedAt,backend}`；catch 里 `redact(errorText(error),[value])`，任何失败分支都不回显值。
  - `secret.delete {ref}`：`repository.delete()` + `store.remove()`。
  - `secret.list`：`repository.list()`（只 ref/configured/updatedAt/backend）+ `backend`。
- **诚实的 `secretConfigured`**：`getConfig`（global providers）与 `agentsView` 改为 `this.secretRegistered(provider.secretRef)` = `ref 存在 ∧ store.has(ref)`（无 store 时退回仓库 list）。新增私有 `requireSecrets()`/`secretRegistered()`，模块级 `secretAudience()`、`requireInstallationCaller()`、`errorText()`、常量 `INSTALLATION_SUBJECT`（顺手替换两处字面量）。

### `apps/cli/src/secret.ts`（新增）

`agentdev secret set <ref> [--audience gateway|tool] | list | delete <ref>`：

- **值只从 stdin 读**（`normaliseStdinValue` 只去掉一个行尾换行），argv 从不接受值；输出只有 ref/元数据，无值。
- 先 `waitForRuntime(home,{timeoutMs:0})` 探活：**有在跑 daemon 走 admin**（`POST`/`DELETE /secret`，stdout `path:"daemon"`）；否则**直连仓库**（`await import('@agentdev/core')` 懒加载，stdout `path:"repository"`）。`runtime.json` 损坏 → `RUNTIME_RECORD_INVALID`（不静默直写）。
- `list` 直接读仓库并打印 `path:"repository"`（admin 只有写路由，没有读路由）。
- 每处失败输出 `{ok:false,error:{code,message},operationId}` 到 stderr、退出码 1；直连写的失败消息过 core 的 `redact(text,[value])`。

### `apps/cli/src/cli.ts`

- USAGE 增加三条；`CliIo` 增加可选 `readStdin`（默认 `readStdinValue`）；新增 `secret` 分支（`io.exit(await runSecretCommand(...))`）。

### `apps/cli/src/runtime.ts`

- `adminRequest` 方法联合加 `'DELETE'`（唯一改动）；文件头 JSDoc 记录「CLI 额外懒加载 core」这一处 `ARCHITECTURE.md` §2 偏差。

### 测试（新增 3 个文件，不改既有断言）

- `packages/core/test/secret-repository.test.ts`（17 例，unit）：file 往返/轮换/删除/工具 secret 元数据、0600 与 0700、记录字节不含明文、错主密钥/缺主密钥/坏主密钥分别报 `SECRET_DECRYPT_FAILED`/`SECRET_MASTER_KEY_MISSING`/`SECRET_MASTER_KEY_INVALID`、非法 ref/value 不落盘、后端选择（env/darwin/linux/未知值）、keychain 假 runner 的 add/find/delete/list 与索引 0600、keychain 拒绝报错、`loadSecretsIntoStore` 全量与失败上报。
- `apps/daemon/test/secret.integration.test.ts`（5 例，integration，真实 home + 真实 daemon + 真实 HTTP）：admin `POST/DELETE /secret`（无凭证 401、坏 JSON 400 且不回显、缺 ref 422）、`/rpc` 的 set/list/delete 全链且响应与日志无值、`config.get`/`agents` 的 `secretConfigured` 先假后真再假、浏览器会话调用 `secret.set` 得 403 `NOT_AUTHORIZED`、**重启后启动装载**（`runtime.secrets.has(ref)` 真、`config.get` 真、日志含 `loaded 1 secret`）。
- `apps/cli/test/secret.integration.test.ts`（3 例，integration，真实子进程 daemon）：无 daemon 时 `path:"repository"` 全流程；有 daemon 时 `path:"daemon"` 且 `secrets/` 下任何文件不含明文；空 stdin / 缺 ref / 非法 `--audience` 得 `VALIDATION_ERROR` + 合法 `operationId` 且不回显值。

## 2. 新增接口（摘要）

```ts
// packages/core（由 index.ts 导出）
type SecretBackendName = 'file' | 'keychain';
interface SecretRecordMetadata { audience: SecretAudience; envName?; purposes?; roles? }
interface StoredSecretRecord { ref; value; metadata; updatedAt; backend }   // 仅 get() 返回
interface SecretRecordSummary { ref; configured; updatedAt; backend }       // list() 只回这个
interface SecretRepository {
  readonly backend: SecretBackendName;
  set(ref, value, metadata?): SecretRecordSummary;
  get(ref): StoredSecretRecord | null;
  delete(ref): boolean;
  list(): readonly SecretRecordSummary[];
}
createSecretRepository(options): SecretRepository           // home/env/backend/platform/securityAvailable/commandRunner/now
resolveSecretBackend(options): SecretBackendName
secretRepositoryPaths(home): { dir; masterKey; keychainIndex }
loadSecretsIntoStore(repo, SecretStore): { loaded; failed[] }
class SecretRepositoryError extends Error { code: SecretRepositoryErrorCode }
type SecretCommandRunner = (command, args) => { status; stdout; stderr }
const SECRET_BACKEND_ENV = 'AGENTDEV_SECRET_BACKEND'
const SECURITY_BINARY = '/usr/bin/security'; const KEYCHAIN_SERVICE = 'agentdev-secret'

// SecretStore 增：remove(ref): boolean      secrets.ts 增：isValidSecretRef(ref): boolean
// 协议（installation-only，无 Project scope）：secret.set / secret.delete / secret.list
// admin：POST /secret {ref,value,audience?}；DELETE /secret {ref}
```

## 3. 真实执行证据（全部本次运行内执行）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0（ESLint + Prettier check 全绿） |
| `pnpm build` | exit 0（含 `apps/cli` 新依赖 core 的构建） |
| `pnpm install --frozen-lockfile --offline` | exit 0（lockfile 已含 `apps/cli → @agentdev/core`） |
| `pnpm docs:check` | exit 0（15 documents / 54 links / 94 AC / 9 requirements / 11 WP） |
| `pnpm test:unit` | **60 文件 / 1172 用例全通过**，exit 0 |
| `pnpm test:integration` | **31 文件 / 331 用例全通过**，exit 0（含真实容器与真实 Git 的既有套件） |
| `pnpm exec vitest run --project unit packages/core/test/secret-repository.test.ts` | 17/17 通过 |
| `pnpm exec vitest run --project integration apps/daemon/test/secret.integration.test.ts apps/cli/test/secret.integration.test.ts` | 8/8 通过 |

### CLI 冒烟 1：无 daemon，直连仓库（built CLI，`apps/cli/dist/cli.js`）

```text
== AGENTDEV_HOME=/tmp/agentdev-secret-smoke-Bok25i (backend=file) ==
== 1) secret set provider/smoke (value from stdin) ==
{ "ok": true, "path": "repository", "backend": "file", "ref": "provider/smoke",
  "configured": true, "updatedAt": "2026-09-14T08:00:04.005Z" }        exit=0
== 2) secret list ==
{ "ok": true, "path": "repository", "backend": "file",
  "items": [ { "ref": "provider/smoke", "configured": true,
               "updatedAt": "2026-09-14T08:00:04.005Z", "backend": "file" } ] }   exit=0
== 3) on-disk record bytes (value must be absent) ==
-rw-------  1 huyaohua  wheel  243  …/secrets/3fec9dbf4c983084ea953ca68fd0549a804f55fbfec7f86e8a02758f2f70f9c6.json
-rw-------  1 huyaohua  wheel   45  …/secrets/master.key
no plaintext occurrence of the value under AGENTDEV_HOME
== 4) secret delete provider/smoke ==
{ "ok": true, "path": "repository", "ref": "provider/smoke", "deleted": true }   exit=0
== 5) secret list after delete ==
{ "ok": true, "path": "repository", "backend": "file", "items": [] }             exit=0
```

（写入值为 `sk-smoke-decoy-9f3a2b7c1d4e`，`grep -rl` 在整个 `AGENTDEV_HOME` 下找不到它。）

### CLI 冒烟 2：`agentdev start` 起的真实 daemon（built 产物），走 admin

```text
== agentdev start (built daemon, no roots) ==
{ "ok": true, "started": true, "home": "/tmp/agentdev-secret-daemon-OkXjGw",
  "pid": 26692, "epoch": 1, "instances": [] }                                  exit=0
== secret set via running daemon (stdin) ==
{ "ok": true, "path": "daemon", "backend": "file", "ref": "provider/daemon-smoke",
  "configured": true, "updatedAt": "2026-09-14T08:00:11.269Z" }                exit=0
== secret list (repository read) ==
{ "ok": true, "path": "repository", "backend": "file",
  "items": [ { "ref": "provider/daemon-smoke", "configured": true,
               "updatedAt": "2026-09-14T08:00:11.269Z", "backend": "file" } ] }  exit=0
== secret delete via running daemon ==
{ "ok": true, "path": "daemon", "ref": "provider/daemon-smoke", "deleted": true }  exit=0
== stdout/stderr/log leak check ==
value absent from every file under AGENTDEV_HOME
== agentdev stop ==
{ "ok": true, "stopped": true, "home": "/tmp/agentdev-secret-daemon-OkXjGw", "pid": 26692 }  exit=0
```

## 4. 已知缺口 / 未做（诚实清单）

1. **WebUI 设置页 API Key 输入与「测试连接」未做**（T1 ④）：本刀只提供 daemon/CLI 入口；`config.get`/`agents` 已给出诚实 `secretConfigured`，UI 控件留给 T4。
2. **`config.save` provider `secretRef` 与 secret 注册的联动校验未做**（T1 ⑤）：可保存一个 `secretRef` 而尚未注册，此时 `secretConfigured:false` 且模型调用失败关闭（`PROVIDER_UNAVAILABLE`），不会静默成功。
3. **`pnpm test:e2e` / `test:acceptance` / `test:live` 本次未运行**：T1 不新增契约命令，新证据并入既有 unit/integration 套件与真实 CLI 冒烟（见上表）。e2e/live 需要真实 Provider 或较长演练，留到 WP-12 收口统一跑。
4. **Keychain 后端的值经 `security` argv 传递**：这是 macOS `security` CLI 的既有形态（`-w <value>`），在极短的子进程生命周期内可能出现在 `ps` 输出里。file 后端与 CLI 本身都不经 argv。若要消除，需要改用 `security` 的交互式 stdin 或直接调用 Security.framework（会引入原生依赖，超出「不加依赖」约束）——**待决策**。
5. **幂等账本会存 `sha256(params)`，其中包含值的哈希**（仅在调用方显式带 `idempotencyKey` 且走 `secret.set/delete` 时）：账本不存明文/密文，但存了值的强哈希。若要连哈希都不落库，需为 secret 方法定制「排除 value 的 payloadHash」——**待决策**。
6. **admin `POST /secret` 的 body 上限是 64 KiB**（`readBody` 既有约束），而仓库层允许 64 KiB 的值；即接近上限的值无法经 admin 写入（直连仓库可以）。CLI 有 daemon 时只走 admin，因此也会碰到。属既有 admin 约束，未改。
7. **`ConfigStore.upsertProvider()` 的返回值仍是 `secretConfigured: ref !== undefined`**：该 API 不持有 SecretStore，无法判定注册；`config.get`/`agents` 已是诚实值。未改动以免破坏既有调用契约。
8. **依赖表偏差（需确认）**：`apps/cli` 现在静态声明 `@agentdev/core`（为「无 daemon 时直连仓库」），而 `ARCHITECTURE.md` §2 的 `apps/cli` 允许依赖只写 `client`。运行时用 `await import('@agentdev/core')` 懒加载，`doctor/start/status/open` 不加载 core；已同步更新 `pnpm-lock.yaml`（`pnpm install --frozen-lockfile` 通过）并在 `apps/cli/src/runtime.ts` JSDoc 记录。若要严格守表，需要把仓库下移到 `packages/client` 或为 CLI 定义专门端口——**待决策**。
9. **未做额外跑**：`node apps/cli/dist/cli.js doctor`、`node scripts/live.mjs --release` 未在本次执行（T1 范围内不需要；收口时统一跑）。
10. 未运行 `git commit`/`git add`；改动全部留在工作区，证据文件即本文件。

> 以上第 4/5/6/8 条已在「修复轮 1」按用户决定处理，修订后的清单见 §6。

## 5. 修复轮 1（用户四项决定，2026-09-14）

### 决定 1：`apps/cli` → `@agentdev/core` 保留（接受）

实现无改动：仍是 `await import('@agentdev/core')` 懒加载，`doctor/start/status/open` 不加载 core。`docs/architecture/ARCHITECTURE.md` §2 的 `apps/cli` 依赖行由用户在结算时更新，本刀不编辑该文档。

### 决定 2：`secret.set` / `secret.delete` 完全不参与幂等账本

- `apps/daemon/src/protocol.ts`：从 `NON_TRANSACTIONAL_LEDGER_METHODS` 移除二者，`dispatch` 直达 `dispatchUnwrapped`，**不再写任何 `command` 行**；二者仍在 `WRITE_METHODS`（仍做写方法鉴权与 `idempotencyKey` 形状校验）。`setSecret`/`deleteSecret` JSDoc 写明「同 ref 替换天然幂等；即使带 `idempotencyKey` 也照常执行、不去重、不记账；值的摘要/HMAC/长度一律不落库」。
- 测试：`apps/daemon/test/secret.integration.test.ts` 新增「records no command-ledger row (and no value digest) for secret.set」——带 `idempotencyKey` 调 `secret.set` 与 `secret.delete` 后，用 `ProjectStore.open` 直连项目真实 SQLite 执行 `SELECT operation, payload_hash FROM command`，断言：无任何 `operation` 以 `secret.` 开头的行；且表中没有任何 `payload_hash` 等于 `sha256(value)`、`sha256(规范 JSON{audience,ref,value})`、`sha256(JSON{ref,value})`。

### 决定 3：默认后端改为全平台 `file`，keychain 仅显式 opt-in

- `packages/core/src/secret-repository.ts`：`resolveSecretBackend` 删除 darwin/`security` 自动探测（连同 `platform` / `securityAvailable` 两个选项一并移除），未设 `AGENTDEV_SECRET_BACKEND` 时恒返回 `file`；模块头与 JSDoc 记明原因——macOS `security` CLI 以 `-w <value>` 经 argv 传值、调用期间可见于 `ps`。
- 测试：`packages/core/test/secret-repository.test.ts` 的默认分支用例改为「所有平台默认 `file`；`AGENTDEV_SECRET_BACKEND=keychain` 才取 keychain」，不再断言 darwin 自动选 Keychain。

### 决定 4：admin 64 KiB 上限改为 typed 413

- `apps/daemon/src/main.ts`：新增导出常量 `ADMIN_BODY_LIMIT_BYTES` 与 `AdminRequestError`（带 `status`/`code`）；`readBody` 超限抛 `413` + `VALIDATION_ERROR`，消息 `the request body exceeds 65536 bytes`；`POST /projects`、`POST /secret`、`DELETE /secret` 的解析 catch 对该类型原样上抛，外层 catch 按类型回状态码，其余错误仍是 `500 INTERNAL_ERROR`。
- 测试：`apps/daemon/test/secret.integration.test.ts` 新增「refuses an oversized body with a typed 413」——70 KiB body → `413`、`error.code === 'VALIDATION_ERROR'`、消息含 `65536`。

### 修复轮 1 命令与真实结果

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0（ESLint + Prettier check 全绿） |
| `pnpm test:unit` | **60 文件 / 1172 用例全通过**，exit 0 |
| `pnpm test:integration` | **31 文件 / 333 用例全通过**，exit 0（首跑曾出现 1 例未复现的偶发失败，随后两次全量重跑均 333/333；未能定位该偶发用例，如实记录） |
| `pnpm build` | exit 0 |
| `pnpm exec vitest run --project unit packages/core/test/secret-repository.test.ts` | 17/17 通过 |
| `pnpm exec vitest run --project integration apps/daemon/test/secret.integration.test.ts` | 7/7 通过 |
| `pnpm exec vitest run --project integration apps/cli/test/secret.integration.test.ts` | 3/3 通过 |

CLI stdin 冒烟（built CLI，**故意不设 `AGENTDEV_SECRET_BACKEND`**，验证默认 `file`）：

```text
== secret set provider/fix1 (stdin) ==
{ "ok": true, "path": "repository", "backend": "file", "ref": "provider/fix1",
  "configured": true, "updatedAt": "2026-09-14T08:09:58.655Z" }               exit=0
== secret list ==
{ "ok": true, "path": "repository", "backend": "file",
  "items": [ { "ref": "provider/fix1", "configured": true,
               "updatedAt": "2026-09-14T08:09:58.655Z", "backend": "file" } ] }  exit=0
== modes / leak scan ==
-rw-------  …/secrets/2adc96aa785fb06fefa776fc896cd5b717c092f70c2b30e9932c3212e500b194.json
-rw-------  …/secrets/master.key
value absent from every file under AGENTDEV_HOME
== secret delete provider/fix1 ==
{ "ok": true, "path": "repository", "ref": "provider/fix1", "deleted": true } exit=0
== secret list after delete ==
{ "ok": true, "path": "repository", "backend": "file", "items": [] }          exit=0
```

（写入值 `sk-fix1-decoy-7b2e4d91`；未设任何后端环境变量仍得 `backend:"file"`，证明默认已改为 file。）

## 6. 修复轮 1 后的缺口清单（修订）

1. **WebUI 设置页 API Key 输入与「测试连接」未做**（T1 ④）→ 留给 UI 切片 T4（本刀只提供 daemon/CLI 入口与诚实的 `secretConfigured`）。
2. **`config.save` provider `secretRef` 与 secret 注册的联动校验未做**（T1 ⑤）：未注册时 `secretConfigured:false`、模型调用失败关闭，不会静默成功。
3. `pnpm test:e2e` / `test:acceptance` / `test:live` 本次未运行；T1 证据并入既有 unit/integration 套件与真实 CLI 冒烟。
4. **Keychain 后端仍以 argv 传值**（macOS `security` CLI 的平台形态）：现为**严格 opt-in**（必须显式 `AGENTDEV_SECRET_BACKEND=keychain`），默认 `file` 不经 argv。维持该限制为已知项。
5. **admin body 上限仍是 64 KiB**，现为 typed `413 VALIDATION_ERROR`（消息含字节数）；接近上限的值仍只能经直连仓库写入，未改动该既有约束。
6. `ConfigStore.upsertProvider()` 的返回值仍是 `secretRef !== undefined`（该 API 不持有 SecretStore）；`config.get`/`agents` 已是诚实值。
7. **依赖表偏差已按决定 1 接受**：`apps/cli` 声明 `@agentdev/core`（懒加载）；`ARCHITECTURE.md` §2 行由用户在结算时更新，本刀未改。
8. 未运行 `node apps/cli/dist/cli.js doctor` / `scripts/live.mjs --release`（收口统一跑）。
9. 工作区同时存在其他 WP-12 切片的改动（`apps/web/**` 及对应测试）；**本刀未触碰这些文件**，`pnpm build`/测试的绿灯包含它们当前状态。
10. 未运行 `git commit`/`git add`；改动全部留在工作区。

## 7. 修复轮 2（独立 Review FAIL：1×P1 + 3×P2 + P3 全量）

Review 报告：`.agentdev/work/WP-12/T1-review.md`。以下按 Review 顺序修复。

### P1（W12T1-01）凭据目录中的外部/损坏文件曾让 `secret list` 与 `agentdev start` 直接失败

两道防御都做了：

- **后端在磁盘上命名空间隔离**（`packages/core/src/secret-repository.ts`）：file 记录移到 `~/.agentdev/secrets/file/<sha256(ref)>.json`，keychain 索引移到 `~/.agentdev/secrets/keychain/index.json`，主密钥仍在 `~/.agentdev/secrets/master.key`。file 后端只扫自己的 `file/` 子目录，并对每条记录校验文件名 == `sha256(envelope.ref)+'.json'`；`keychain.json`/任意散落文件不再被当成记录。`secretRepositoryPaths()` 新增 `fileDir`/`keychainDir`。
- **装载逐条容错、绝不致命**：`SecretRepository.list()` 不再抛错（新增 `problems()` 返回无法识别的文件：损坏 JSON、文件名不匹配、符号链接、非普通文件）；记录可解析但当前主密钥解不开时按 ref 返回 `configured:false` + `health:'unreadable'` + `issue:{code,message}`。`loadSecretsIntoStore` 返回 `{loaded, failed, problems}` 且整体 try/catch；`main.ts` 先日志再继续启动，并把整段装载包在 try/catch 内。`secret.list` 透出 `health/issue/problems`；`secretRegistered()` 回退路径只看 `health==='ok'`，`config.get`/`agents` 不再可能 500。

回归测试：单测「ignores a foreign keychain index and stray files outside its namespace」「reports a corrupt record inside its own namespace and keeps the others」「reports a corrupt index instead of throwing」「refuses to read a record that is a symlink」；集成「starts and lists despite a foreign keychain index and a corrupt record」「starts with an undecryptable record and reports it as unreadable」；CLI「stays green when the store holds foreign and corrupt files」。Review 的原始复现（见 §8）现为绿灯。

### P2-1（W12T1-02）两个后端共用目录、切换时静默互相隐藏

命名空间隔离同时修复该问题：切换后端时非活动后端的记录既不被装载、也不出现在 `failed`、也不会被删除。测试：「does not load, report or delete the other backend records on a switch」。

### P2-2（W12T1-03）被拒绝的 `set` 已经落盘（派生 envName >128）

`secret-repository.ts` 的 `assertRef` 现在同时校验 ref 形状（`isValidSecretRef`）与派生环境变量名上界（`secretEnvName(ref).length <= MAX_SECRET_ENV_NAME_LENGTH`，`secrets.ts` 新导出该常量并在 `isValidSecretRef` JSDoc 记明「只管形状，不管派生名」）；`set` 在读/建主密钥与写文件之前完成校验。三条路径（`/rpc`、admin、CLI 直写）都不再留下部分副作用。测试：「rejects a ref whose derived env name would not fit, before writing」覆盖 112（128 字符，接受）与 113（129，拒绝）边界，并断言磁盘上只有被接受的那一条。

### P2-3（W12T1-04）缺主密钥被静默重建、令既有记录永久不可解

`requireMasterKey(true)` 只在**没有任何记录**时创建新密钥；已有记录而主密钥缺失时抛 `SECRET_MASTER_KEY_MISSING`（消息含路径并说明这些记录在缺密钥时不可读），不写新记录、不写新密钥。测试：「never regenerates a missing master key while records exist」「creates the master key for a fresh store」。

### P3（全部）

- `--stdin`：`agentdev secret set <ref> [--stdin]` 接受该 flag（显式 no-op，值本来就只从 stdin 读）；USAGE 同步。
- 记录权限过宽：读取前 `enforcePrivateMode(path)` 修复为 0600（修不好才报错），不再忽略。
- 不跟随符号链接：新增 `readPrivateFile()`（`O_RDONLY|O_NOFOLLOW`）与 `lstatSync` 判型；记录/主密钥/索引是符号链接或非普通文件一律拒绝，写入目标为非普通文件也拒绝（`assertReplaceable`）。
- 启动失败释放锁：`startRuntime` 在取得锁之后把 auth/凭证/仓库/装载/监听整段包进 try/catch，失败即 `releaseDaemonLock(home, epoch)`（epoch 校验，不动新主人）。实测 `AGENTDEV_SECRET_BACKEND=bogus` 启动失败后**没有**残留 `daemon.lock`。
- admin `/health` 不再返回 `home`（`instances`/`version`/`ready`/`epoch`/`pid`/`execution` 保留）；集成测试断言响应无 `home`。
- 测试名/断言缺口：修掉误导性注释（CLI daemon 路径改为「直读仓库」）；`secret.delete`/`secret.list` 的浏览器会话拒绝补齐并断言安装调用者随后成功；`--audience tool` 正向路径与未知 audience 422；记录 0644 修复；65536 恰好接受 / 65537 拒绝；P1 负例（上）。
- 文档（本次授权）：`docs/architecture/protocol.md` §5 增 `secret.set*`/`secret.delete*`/`secret.list` 三行与「安装级调用主体、值不回显、set/delete 不进幂等账本、health/problems 语义」说明；`docs/architecture/reliability.md` §7 的 CLI 契约行加入 `secret set/list/delete`，并新增 Provider Secret 持久化（默认 file、keychain opt-in、argv 说明、缺主密钥拒绝重建、坏文件不阻断启动）。

## 8. 修复轮 2 证据（本次运行内真实执行）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | **exit 1 —— 28 个错误全部在 `scripts/**` 与 `tests/browser/**`（其他 WP-12 Agent 正在改的文件，本刀未触碰）**；对 T1.1 全部文件单独跑 `eslint`（含 TS6 preload）exit 0，`prettier --check` exit 0 |
| `pnpm test:unit` | **60 文件 / 1193 用例全通过**，exit 0 |
| `pnpm test:integration` | **31 文件 / 338 用例全通过**，exit 0（含真实容器与真实 Git） |
| `pnpm docs:check` | exit 0（15 documents / 54 links / 94 AC / 9 requirements / 11 WP） |
| `pnpm build` | exit 0 |
| `pnpm install --frozen-lockfile --offline` | exit 0 |
| 目标用例 `packages/core/test/secret-repository.test.ts` | 26/26 通过 |
| 目标用例 `apps/daemon/test/secret.integration.test.ts` | 10/10 通过 |
| 目标用例 `apps/cli/test/secret.integration.test.ts` | 5/5 通过 |

### Review 的 P1 原始复现（现在绿灯）

```text
== setup: leftover keychain index + junk (reviewer repro) ==
secrets/file/garbage.json
secrets/keychain/index.json
secrets/garbage.json
== 1) secret list (was exit 1 before the fix) ==
{ "ok": true, "path": "repository", "backend": "file", "items": [],
  "problems": [ { "path": ".../secrets/file/garbage.json", "code": "SECRET_RECORD_INVALID",
                  "message": "the secret record .../garbage.json is not valid JSON" } ] }
exit=0
== 2) agentdev start (was START_TIMEOUT before the fix) ==
{ "ok": true, "started": true, "home": "/tmp/wp12-p1-fix2-home.wZpheM",
  "pid": 55472, "epoch": 1, "instances": [] }
exit=0
== 3) daemon log lines about the unusable files ==
1
agentdevd: ignoring an unusable secret file (SECRET_RECORD_INVALID): the secret record .../file/garbage.json is not valid JSON
== 4) stop ==
{ "ok": true, "stopped": true, "home": "...", "pid": 55472 }   exit=0
```

### CLI stdin 冒烟（built CLI，默认 file 后端，不设 `AGENTDEV_SECRET_BACKEND`）

```text
== secret set provider/main (stdin) ==
{ "ok": true, "path": "repository", "backend": "file", "ref": "provider/main",
  "configured": true, "updatedAt": "2026-09-14T09:11:31.490Z" }                exit=0
== secret list ==
{ "ok": true, "path": "repository", "backend": "file",
  "items": [ { "ref": "provider/main", "configured": true, "health": "ok",
               "updatedAt": "2026-09-14T09:11:31.490Z", "backend": "file" } ],
  "problems": [] }                                                             exit=0
--- secrets/ ---  drwx------ file/  -rw------- master.key
--- secrets/file/ ---  -rw------- 687bb8fc…json
value absent from every file under AGENTDEV_HOME
== secret delete provider/main ==
{ "ok": true, "path": "repository", "ref": "provider/main", "deleted": true }  exit=0
== secret list ==
{ "ok": true, "path": "repository", "backend": "file", "items": [], "problems": [] }  exit=0
```

失败启动不留锁（P3）：`AGENTDEV_SECRET_BACKEND=bogus node apps/cli/dist/cli.js start` → `START_TIMEOUT` + `logTail: START_FAILED: AGENTDEV_SECRET_BACKEND must be "file" or "keychain"`，随后 `ls $AGENTDEV_HOME/daemon.lock` 不存在（`no stale lock after the failed start`）。

## 9. 修复轮 2 后的缺口清单（修订）

1. **WebUI 设置页 API Key 输入与「测试连接」未做**（T1 ④）→ UI 切片 T4。
2. **`config.save` provider `secretRef` 与 secret 注册的联动校验未做**（T1 ⑤）。
3. `pnpm test:e2e` / `test:acceptance` / `test:live` 本次未运行；其证据由 WP-12 收口统一跑。
4. **Keychain 后端仍以 argv 传值**（macOS `security` 平台形态）：严格 opt-in，默认 `file` 不经 argv。
5. **admin body 上限 64 KiB** 为 typed `413 VALIDATION_ERROR`；恰好 65536 接受、65537 拒绝（已测）；接近上限的大值仍只能经直连仓库写入。
6. `ConfigStore.upsertProvider()` 返回值仍是 `secretRef !== undefined`；`config.get`/`agents` 为诚实值。
7. **`pnpm lint` 全仓库当前非零**：28 个错误全部来自并行 Agent 正在修改的 `scripts/**` 与 `tests/browser/**`；T1.1 文件 scoped eslint/prettier 均干净。收口时需等这些切片修好。
8. 未运行 `node apps/cli/dist/cli.js doctor` / `scripts/live.mjs --release`（收口统一跑）。
9. **并发写者**仅由 Review 探针实测 4/4 成功（`O_CREAT|O_EXCL` 主密钥竞争正确），本次未补自动化用例（仓库 API 同步，进程内无法真实并发）；登记为残余。
10. 工作区同时存在其他 WP-12 切片的改动（`apps/web/**`、`package.json`、`pnpm-lock.yaml`、`scripts/**`、`docs/architecture/ARCHITECTURE.md`、`tests/**`）；**本刀未触碰**，绿灯包含其当前状态。
11. 未运行 `git commit`/`git add`；改动全部留在工作区。

## 10. 修复轮 3（复核轮 2 PASS 后的 5 条 P3，其中 3 条判为必修）

### R2-03（升为 P2）健康响应泄漏路径

- `apps/daemon/src/main.ts`：admin 面 `/health`/`/healthz` 的响应不再包含 `instances`（其中带 `root`），改为非路径状态 `projects: instances.length`；仍保留 `ok/ready/version/epoch/pid/execution`。`GET /projects`（安装凭证）仍返回完整实例列表，运维入口不变。
- `apps/daemon/src/server.ts`：项目 daemon 的 `/healthz` 本就只回 `{version,ready}`；补注释钉死「不含任何文件系统路径」的契约。
- 负例测试：`apps/daemon/test/runtime.integration.test.ts` 与 `apps/daemon/test/secret.integration.test.ts` 断言 admin `/health`、admin `/healthz`、项目 `/healthz` 的**原始响应文本**都不含 `home`、仓库根（含 realpath）或 `"root"`；`runtime.integration.test.ts` 原 `body.instances` 断言改为 `body.projects===1`。

### R2-01 keychain `list()` 从不校验、`delete` 不清索引行

- `packages/core/src/secret-repository.ts`：keychain 后端新增 `scan()`——逐行 `find-generic-password` 探活；项存在 → `health:'ok'`；退出码 44 → `health:'missing'` + `issue.code='SECRET_NOT_FOUND'` 并进入 `problems`；其他非 0 → `health:'unreadable'` + `SECRET_KEYCHAIN_FAILED` 并进入 `problems`。`list()`/`problems()` 共用该扫描。
- `delete()` 现在无论 Keychain 项是否存在都会清理对应索引行：项与行都在或只有行在 → 清理并返回 `true`；两者都没有 → `false`；删除本身失败（非 44）→ typed `SECRET_KEYCHAIN_FAILED` 且保留索引行。
- 新增枚举 `SecretRecordHealth` 值 `'missing'` 与错误码 `SECRET_NOT_FOUND`。
- 测试（`packages/core/test/secret-repository.test.ts`）：「validates stale and unreadable index rows, and cleans them on delete (R2-01)」要求陈旧行被标 `missing`、进入 `problems`、装载计入 `failed(SECRET_NOT_FOUND)`，且 `delete` 返回 `true` 后 `list()`/`problems()` 收敛为空、再删返回 `false`；「marks an index row the Keychain refuses to read as unreadable」覆盖非 44 读失败与 delete 失败的类型化错误。

### R2-02 目录/符号链接记录的 `delete()` 抛未类型化 `ERR_FS_EISDIR`

- `FileSecretRepository.delete()`：`lstat` 判型后只删除普通文件；`directory`/`other`（含符号链接）抛 `SECRET_RECORD_INVALID`（消息含路径与类型），`rmSync` 的任何文件系统错误映射为 `SECRET_STORE_FAILED`（含路径与原因）；不存在仍返回 `false`。
- 测试：原符号链接用例改为断言 `delete` 被类型化拒绝且链接仍在；新增「reports the three delete outcomes with typed errors (R2-02)」覆盖不存在（`false`）、目录（`SECRET_RECORD_INVALID` 且目录仍在）、符号链接（`SECRET_RECORD_INVALID` 且链接仍在）三种情况。

### R2-05（措辞与实现对齐，不改行为）

- `ADMIN_BODY_LIMIT_BYTES` 的 JSDoc 与 `readBody` 注释改为「**恰好该字节数的请求体接受**，多 1 字节才拒绝」；集成测试注释同样点明 65536 接受 / 65537 拒绝。行为未变。

### R2-04（记录在案，不修）

- pre-round-2 的扁平布局记录（`secrets/<sha256>.json`）在轮 2 后不再被 file 后端扫描，属**静默忽略**。判定：**接受，不做迁移**——T1.1 从未发布、无真实安装数据（密钥入口在 WP-12 之前根本不存在），迁移代码只会增加一次性的、无法被真实数据验证的路径；本刀只保证新布局正确，旧布局文件保留在磁盘上但不被读取（`secret list` 的 `problems` 不会误报它们，因为它们不在 `file/` 命名空间内）。

## 11. 修复轮 3 证据（本次运行内真实执行）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | 修复期间 exit 0；随后并行 Agent 改动 `packages/core/test/orchestrator.test.ts` 使其 exit 1（**全部错误只在该文件**：`requirementId: undefined` 不满足 `Record<string, JsonValue>`）。排除该文件后 `tsc` exit 0（临时 `tsconfig.t11-check.json` 验证后删除），证明 T1.1 文件无类型错误 |
| `pnpm docs:check` | exit 0（15 documents / 54 links / 94 AC / 9 requirements / 11 WP） |
| `pnpm test:unit` | 首次运行 1 例失败（并行 Agent 新增第 61 个测试文件后的偶发，未复现）；**重跑 61 文件 / 1210 用例全通过，exit 0** |
| `pnpm test:integration apps/daemon apps/cli` | **8 文件 / 68 用例全通过**，exit 0 |
| `packages/core/test/secret-repository.test.ts` | 29/29 通过 |
| `pnpm build` | exit 0 |
| T1.1 文件 scoped `eslint`（TS6 preload）/ `prettier --check` | exit 0 / exit 0 |
| `pnpm lint`（全仓库） | 仍 exit 1（错误全在并行 Agent 的 `scripts/**`、`tests/browser/**` 等；本刀未触碰） |

### R2-03：真实 `agentdev start` + `curl` 原始输出

```text
== agentdev start --root /tmp/wp12-r203-repo.nzQA8H ==
{ "ok": true, "started": true, "home": "/tmp/wp12-r203-home.QpdF44", "pid": 81744, "epoch": 1,
  "instances": [ { "root": "/private/tmp/wp12-r203-repo.nzQA8H", "daemon": {"host":"127.0.0.1","port":4318}, ... } ] }
start_exit=0
== curl admin GET /healthz (raw) ==
{"ok":true,"ready":true,"version":"0.1.0","epoch":1,"pid":81744,"projects":1,"execution":{"enabled":true,"live":0}}
== curl admin GET /health (raw) ==
{"ok":true,"ready":true,"version":"0.1.0","epoch":1,"pid":81744,"projects":1,"execution":{"enabled":true,"live":0}}
== curl project daemon GET /healthz (raw) ==
{"version":"0.1.0","ready":true}
== path-leak scan on both health bodies ==
no home path in any health body
no project root in any health body
no root field in any health body
== stop ==
{ "ok": true, "stopped": true, "home": "/tmp/wp12-r203-home.QpdF44", "pid": 81744 }   stop_exit=0
```

（`runtime.json` 与 `agentdev start` 的 stdout 仍含 `home`/`root`，那是给本机 CLI/运维的安装级记录，不是健康响应。）

## 12. 修复轮 3 后的缺口状态（R2-01…R2-05 与遗留）

| 编号 | 处理 |
|---|---|
| R2-01 | 已修（keychain 逐行校验 + `missing`/`unreadable` + `problems` + delete 清索引行）；测试见 §10 |
| R2-02 | 已修（file `delete` 对目录/符号链接/不存在三态类型化）；测试见 §10 |
| R2-03 | 已修（admin `/health` `/healthz` 与项目 `/healthz` 均无路径；负例 + 真实 curl 证据）；admin 面不退回 |
| R2-04 | **已接受，未做迁移**（T1.1 未发布、无真实数据；理由见 §10） |
| R2-05 | 已修措辞（上限为「含」该字节数；行为未变） |
| T1 ④/⑤ | WebUI API Key 输入与 `config.save` secretRef 联动仍留给 UI 切片 T4 |
| Keychain argv | 平台限制，严格 opt-in；默认 file 不经 argv |
| 并发写者 | 仅 Review 探针实测 4/4；仓库 API 同步，进程内无法真实并发，仍为残余 |
| 全仓库 lint | 仍受并行 Agent 的 `scripts/**`/`tests/browser/**` 影响；T1.1 文件 scoped 干净 |
| e2e/acceptance/live | 未运行，收口统一跑 |
| 未提交 | 未 `git commit`/`git add`；改动留在工作区 |
