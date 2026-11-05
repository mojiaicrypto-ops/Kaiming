# WP-12 T1.1 独立 Review — Secret/Provider 凭据入口（持久仓库 + 协议命令 + CLI）

- 复核对象：`packages/core/src/secret-repository.ts`、`secrets.ts`、`runtime.ts`、`index.ts`、`execution.ts`、`gateway-http.ts`；`apps/daemon/src/{main,bootstrap,protocol}.ts`；`apps/cli/src/{secret,cli,runtime}.ts`；测试 `packages/core/test/secret-repository.test.ts`、`apps/daemon/test/secret.integration.test.ts`、`apps/cli/test/secret.integration.test.ts`。
- 基线：`HEAD=7c723ec`（WP-11 结算点），实现为工作树未提交改动（`packages/core|apps/daemon|apps/cli` 共 9 文件 +427/-12，另 3 个新测试文件）。
- 契约依据：`docs/architecture/protocol.md` §1–§5/§7、`docs/architecture/execution.md` §4、`docs/architecture/reliability.md` §1/§7/§8、`docs/rules/agents.md` §5、`docs/delivery/acceptance.md` AC-075/078、WP-12 `plan.md` §4 T1。
- 独立上下文：未读取 `.agentdev/work/WP-12/T1-implementation.md`、`T1.2b-implementation.md` 或任何开发聊天。
- 干扰声明：复核期间其他 Agent 正在改 `apps/web/**`、`package.json`、`scripts/**`、`pnpm-lock.yaml`、`docs/architecture/ARCHITECTURE.md`。这些改动我未纳入判定；本轮 `typecheck/lint/unit/integration` 在该工作树上全绿，未被干扰。
- 判定规则：任一 P0/P1 可复现即 **FAIL**。

## 结论

**FAIL —— 1 条可复现 P1（W12T1-01）。**

功能主干（值不进明文/日志/账本、安装级 ACL、0600/0700、原子写、启动装载、诚实 `secretConfigured`）经本人实跑全部成立；P1 是**可用性/契约缺陷**：凭据目录里只要有一个非本后端的 `*.json`，`agentdev start` 与 `agentdev secret list` 直接失败——而产品自己文档化的 Keychain 后端（opt-in）会在同一目录留下 `keychain.json`，因此「试用一次 Keychain 再切回默认 file」即可让整个安装无法启动，且与实现自己写下的「not fatal」注释矛盾。

## 1. 已执行的命令与真实结果

| # | 命令（cwd=仓库根，均先 `export PATH="$HOME/.local/bin:$PATH"`） | 真实结果 |
|---|---|---|
| 1 | `pnpm typecheck` | exit 0，无输出 |
| 2 | `pnpm lint` | exit 0（`All matched files use Prettier code style!`） |
| 3 | `pnpm docs:check` | exit 0（`15 documents, 54 internal links, 94 acceptance cases, 9 requirements, 11 work packages`） |
| 4 | `pnpm exec vitest run --project unit packages/core/test/secret-repository.test.ts` | exit 0，`17 passed (17)` |
| 5 | `pnpm exec vitest run --project integration apps/daemon/test/secret.integration.test.ts` | exit 0，`7 passed (7)` |
| 6 | `pnpm exec vitest run --project integration apps/cli/test/secret.integration.test.ts` | exit 0，`3 passed (3)` |
| 7 | `pnpm exec vitest run --project unit` | exit 0，`60 files / 1184 passed` |
| 8 | `pnpm exec vitest run --project integration apps/daemon apps/cli` | exit 0，`8 files / 63 passed` |
| 9 | CLI 冒烟（源码入口 + `AGENTDEV_HOME=$(mktemp -d)`）：`printf '%s\n' "$VAL" \| node /tmp/wp12-cli-smoke.mjs secret set provider/main` → `secret list` → `secret delete` | exit 0/0/0；`path` 依次为 `repository`；目录 `drwx------`(0700)，`master.key`/记录文件 `-rw-------`(0600)；`grep -rl "$VAL" $AGENTDEV_HOME` → 无命中 |
| 10 | CLI 冒烟（真实 daemon 子进程，`AGENTDEV_DAEMON_ENTRY` 指向源码）：`start --root <tmp git repo>` → `secret set` → `secret list` → `secret delete` → `stop` | 全 exit 0；`set` 报 `"path":"daemon"`；daemon 日志无值、`grep` 无命中；日志含 `agentdevd: loaded 1 secret(s) from the file backend` |
| 11 | P1 复现（见 §2） | `secret list` exit 1；`start` exit 1（START_TIMEOUT） |
| 12 | 对抗探针（`node /tmp/wp12-probe.mjs`：截断主密钥、缺主密钥后再 `set`、并发 4 写者、记录文件符号链接、记录文件被改成 0644） | 见 §2/§4 各条 |
| 13 | 实时协议探针（`node /tmp/wp12-probe2.mjs`：413 覆盖、参数校验、幂等键重放、浏览器会话拒绝、泄漏扫描） | 见 §5 |

## 2. 阻塞发现（P1）

### W12T1-01 凭据目录中任何一个非 file 记录 / 损坏的 `*.json` 会让 daemon 无法启动

**位置**

- `packages/core/src/secret-repository.ts:363-378` — `FileSecretRepository.list()` 把 `secrets/` 下**所有** `*.json` 当作自己的密文记录，逐个 `parseEnvelope`。
- `packages/core/src/secret-repository.ts:632-658` — `parseEnvelope` 对不合格 JSON 直接 `throw SecretRepositoryError('SECRET_RECORD_INVALID')`（不跳过、不降级）。
- `packages/core/src/secret-repository.ts:232` — `loadSecretsIntoStore` 的 `try/catch` 在 `for` **循环体内**，`repository.list()` 本身抛错时异常直接逃逸。
- `apps/daemon/src/main.ts:212` — `loadSecretsIntoStore(...)` 在 `try {`（main.ts:399）**之前**执行；抛错即 `startRuntime` reject。
- `apps/daemon/src/main.ts:219-224` — 注释与实现相反：*"Loud, but not fatal: a broken record must not stop the UI from starting."*
- `packages/core/src/secret-repository.ts:556-565` — Keychain 后端的索引写在同一目录的 `keychain.json`（`SECRETS_DIR_NAME`/`KEYCHAIN_INDEX_FILE`，`:60-62`）。

**精确复现（本次实跑）**

```bash
export PATH="$HOME/.local/bin:$PATH"
export AGENTDEV_HOME=$(mktemp -d /tmp/wp12-p1b-home.XXXXXX)
export AGENTDEV_DAEMON_ENTRY=/tmp/wp12-daemon-entry.mjs   # 源码引导，等价于 dist 入口
# ① 只用一次文档化的 opt-in Keychain 后端（注入 runner 代替真实 security CLI），生成 keychain.json
node --input-type=module -e "...createSecretRepository({home, backend:'keychain', commandRunner:fake}).set('provider/main','sk-live-keychain-decoy')"
# → $AGENTDEV_HOME/secrets 只有 keychain.json

# ② 切回默认 file 后端
export AGENTDEV_SECRET_BACKEND=file
node /tmp/wp12-cli-smoke.mjs secret list          # exit 1
# stderr: {"ok":false,"error":{"code":"SECRET_RECORD_INVALID",
#          "message":"the secret record .../secrets/keychain.json does not match the contract"},...}
node /tmp/wp12-cli-smoke.mjs start --root <tmp-git-repo>   # exit 1
# {"ok":false,"error":{"code":"START_TIMEOUT",...,
#   "logTail":"START_FAILED: the secret record .../secrets/keychain.json does not match the contract"}}
```

等价的更弱触发（任意损坏文件）也已复现：把 `printf 'this is not JSON\n' > $AGENTDEV_HOME/secrets/garbage.json` 后，`secret list` exit 1，`start` exit 1、daemon 日志 `START_FAILED: ... garbage.json is not valid JSON`。
后果：`agentdev start` 起不来 → BFF/WebUI、需求池、全部执行能力都不可用（`reliability.md` §7 要求 Core 存储检查通过即应能提供需求读取）。删除坏文件后下一次 `start` 成功（epoch=2，陈旧锁被接管），说明只有坏文件是硬阻断因。

**要求修复**

1. file 后端只认自己的记录：`list()` 校验文件名 == `sha256(envelope.ref)+'.json'`（`recordPath` 已定义该规则），并显式忽略/隔离 `keychain.json`；或更彻底地让两个后端使用不同子目录（如 `secrets/records/` 与 `secrets/keychain/`）。
2. 加载必须降级而非致命：`list()` 返回逐条失败（或在 `loadSecretsIntoStore` 内逐文件 `try/catch`），坏记录只让**该 ref** `configured:false` 并记一条日志，daemon 照常启动；`secretRegistered` 的 `repository.list()` 回退路径同样不能把 `config.get`/`agents` 变成 500。
3. 补回归测试：① Keychain 索引存在时 file 后端 `list()`/`startRuntime` 成功；② 一个损坏 `*.json` 时 `startRuntime` 成功、坏 ref 出现在 `failed` 里且其余 ref 正常装载。

## 3. 非阻塞发现（P2）

- **W12T1-02 两个后端共用目录，切换时静默互相隐藏记录。** `secret-repository.ts:556-565`（keychain `list()` 只读索引）与 `:363-378`（file `list()` 只读 `*.json`）互不可见。实测：先 file 写 `provider/fromfile`，再以 keychain 打开 `loadSecretsIntoStore` 得到 `{"loaded":0,"failed":[]}`——已注册的 Provider 凭据无声消失、`config.get` 报 `secretConfigured:false`、Provider 直接阻断，没有任何诊断。修复与 W12T1-01 同族（后端命名空间隔离 + 切换时显式诊断）。
- **W12T1-03 `secret.set` 对被拒绝的请求已经落盘（部分副作用）。** `secret-repository.ts:287-315` 先写持久记录，协议/CLI/admin 之后才 `SecretStore.put`；而 `secrets.ts:239-245` 用**派生 envName ≤128** 二次校验，`secretEnvName` 前缀 17 字符 → ref 长度 112–128 通过 `isValidSecretRef`（`:614-621`）却在 `put` 处 `VALIDATION_ERROR`。实测 ref=`'a'.repeat(120)`：`repository.set` 成功、`store.put` 抛 `VALIDATION_ERROR ... envName must be an uppercase environment variable name`，随后 `list()` 仍报该 ref `configured:true`、`get()` 仍能解出值。即 `/rpc secret.set`、`POST /secret`、CLI 直写三条路径都会「报错但记住凭据」，违反 `reliability.md` §1/§5「被拒绝的调用不留副作用」。修复：在 `assertRef`/`isValidSecretRef` 里同时校验派生 envName（或把 `MAX_REF_LENGTH` 收到 111），并补 111/112 边界测试。
- **W12T1-04 主密钥缺失时被静默重建，令既有记录永久不可解。** `secret-repository.ts:398-425`：`set` 走 `requireMasterKey(true)`，只要文件不在就生成新密钥，不检查目录里是否已有记录。实测：写 `a/b` 后删 `master.key`，再 `set('c/d', ...)` → 新密钥、`keyChanged=true`、`repo.get('a/b')` 变 `SECRET_DECRYPT_FAILED`，而 `list()` 仍显示两条 `configured:true`。建议：存在记录却无主密钥时拒绝 `set`（`SECRET_MASTER_KEY_MISSING`），或在缺密钥时只允许显式轮换/重建路径；至少落一条显式告警。补一条「缺密钥 + 已有记录」的负例。

## 4. 非阻塞发现（P3）

- `apps/cli/src/secret.ts:125,228-244`：WP-12 `plan.md` §4 T1 写的是 `secret set <ref> [--stdin]`，实现不接受 `--stdin`（报 `unknown option`）。读 stdin 作为唯一入口是更安全的默认，但契约文字需对齐。
- `apps/cli/src/secret.ts:67-84`：`secret list` 恒报 `"path":"repository"`（daemon 在跑时 `set/delete` 报 `daemon`）；且 `list` 不解密，主密钥丢失时仍报 `configured:true`，可能与 `config.get` 的 `secretConfigured:false` 互相矛盾。
- `apps/cli/src/secret.ts:105-107,154-156`：daemon 路径的失败分支未用 stdin 值 `redact`（只有 repository 分支做了）。当前没有能把值带进这些错误文本的路径，但防护不对称。
- `secret-repository.ts:363-378,386-390`：读取时不校验记录文件权限（只有主密钥走 `enforcePrivateMode`，`auth.ts:116-124`）。实测把记录 chmod 0644 后 `get()` 照常读出；execution.md §4 要求密文记录 0600。
- `secret-repository.ts:386-390`：读取跟随符号链接（无 `O_NOFOLLOW`）。实测符号链接到店外文件只得到 `ERR_CRYPTO_INVALID_IV`（AAD 绑定 ref，无法跨 ref 解密），不构成泄漏，但「不跟随符号链接」这条属性没有实现。
- `apps/daemon/src/main.ts:181-224`：`acquireDaemonLock` 之后的任何抛错（坏记录、非法 `AGENTDEV_SECRET_BACKEND`）都不会释放锁文件。下一次 `start` 靠陈旧锁接管自愈（已实测 epoch=2 成功），仅属清洁度问题。
- `apps/daemon/src/main.ts:454-468`：admin `/health`/`/healthz` 返回 `home` 与项目 root 路径，与 `protocol.md` §5「健康返回版本与 ready，不返回路径和 Secret」的精神不符（既有行为，非本次引入）。
- 文档面：`docs/architecture/protocol.md` §5 方法表与 `docs/architecture/reliability.md` §7 CLI 契约均未列出 `secret.set/delete/list` 与 `agentdev secret`；`docs:check` 不会发现这种漂移，需在 Settlement 补齐方法/参数/结果字段（`{backend,items{ref,configured,updatedAt,backend}}`）。
- `apps/cli/src/runtime.ts:12-15`：源码注释指向过程产物 `.agentdev/work/WP-12/T1-implementation.md`，不宜留在发布代码里（冻结说明允许的 §2 依赖行已在工作树更新）。
- 测试名与断言不符：`apps/daemon/test/secret.integration.test.ts:341` 名为「record it cannot read 时不让整次装载失败」，实际只破坏**主密钥**（走 `get()` 分支），恰好没覆盖 `list()` 解析失败这一条（即 P1）。补测见 W12T1-01 修复项 3。
- `apps/daemon/test/secret.integration.test.ts:352` 名为「refuses a browser session and keeps the installation caller」，只断言浏览器 403 与 store 未变，未断言安装调用者随后成功。
- `apps/cli/test/secret.integration.test.ts:152` 注释「The daemon's own view lists it」不准确：CLI `secret list` 直读仓库（无 admin 读路由），断言本身仍成立。
- 缺失负例（按优先级）：坏记录文件（P1）、缺主密钥后再 `set`（P2）、112/128 字符 ref（P2）、`--audience tool` 正向路径、`/rpc` 未知 audience（422 已实测但无测试）、`secret.delete/list` 的浏览器会话拒绝、并发写者、记录权限被放宽、64 KiB 边界（65536 恰好值）。
- `secret.list` 每条恒为 `configured:true`（`secret-repository.ts:370-375` 硬编码），字段无信息量。

## 5. 已验证的声明（本人实跑复现）

1. **值不外泄**：`secret.set/delete/list`、`config.get`、`agents` 响应、daemon 日志、`secret list` stdout 均不含值（探针 13 逐项 `includes(DECOY)===false`）；密文记录文件字节不含值；`JSON.stringify(repository)`/`list()` 不含值（单测覆盖）。
2. **值只从 stdin 进 CLI**：`readStdin` 是唯一来源，`--audience` 之外的 argv 不携带值；CLI 失败输出为 `{ok:false,error:{code,message},operationId}`（实测 `operationId` 为 UUID，`out` 为空）。
3. **ACL 正确**：浏览器 cookie 会话调 `secret.set/list/delete` 均 403 `NOT_AUTHORIZED`，`details.subject` 为 `user:<sessionId>`（非 `installation:local`）；admin `/secret` 无 Bearer 401；安装 Bearer 200。`apps/daemon/src/server.ts:419` 也确认 cookie 主体形如 `user:<sessionId>`。
4. **幂等账本不入 secret**：`secret.set/delete` 带 `idempotencyKey` 走 `WRITE_METHODS` 但不在 `LEDGER_WRAPPED_METHODS`/`NON_TRANSACTIONAL_LEDGER_METHODS`（`protocol.ts:257-309`）；实测同键两次都 `applied`（不重放），`command` 表无 `secret.*` 行且无值摘要（集成测试 `:312-350`）。
5. **启动装载生效**：重启后 `secret.set` 的 ref 被重新注册（`secret.integration.test.ts:383-399`），daemon 日志确认 `loaded N secret(s)`。
6. **诚实 `secretConfigured`**：注册前 false → 注册后 true（`config.get` 与 `agents` 同源）→ 删除后 false（`protocol.ts:1496,1519,2755-2760`）；未发现编码旧语义（`secretRef !== undefined`）的测试或 drill 消费方（`scripts/**` 无 `secretConfigured` 引用）。
7. **413 覆盖所有读 body 的 admin 路由**：`POST /projects`、`POST /secret`、`DELETE /secret` 均返回 413 + `VALIDATION_ERROR` + `the request body exceeds 65536 bytes`（探针 13 实跑）。
8. **file 后端 0600/0700 + 原子写 + 并发安全**：目录 0700、`master.key` 与记录 0600（实测 `statSync`）；4 个并发进程在全新 home 各写一个 ref，4/4 成功且全部可读（无孤儿记录，`O_CREAT|O_EXCL` 主密钥竞争正确）。
9. **主密钥错误/截断失败响亮**：截断为 16 字节 → `SECRET_MASTER_KEY_INVALID`；缺失 → `SECRET_MASTER_KEY_MISSING`（`get`）；换密钥 → `SECRET_DECRYPT_FAILED`（单测 + 探针）。
10. **Keychain 适配器被真实测试覆盖**：注入 runner 断言 `add/find/delete-generic-password` 的精确 argv（含 `-s agentdev-secret`、`-U`）、44 视为 not-found、索引仅元数据且 0600、失败映射 `SECRET_KEYCHAIN_FAILED` 且消息不含值（`secret-repository.test.ts:210-325`）。值进入 `-w` argv（`calls[0]` 含 DECOY）与冻结说明的已知平台限制一致。
11. **注册 ≠ 授权、resolve 策略未改**：`git diff packages/core/src/secrets.ts` 仅新增 `isValidSecretRef` 与 `SecretStore.remove`，`resolve/admit/scopeAllows` 未动；gateway 解析仍走 `SecretContext` + 授予行（`execution.ts:150-156`），错误消息只含 ref。
12. **`config.test`/既有消费者无回归**：全量 `unit`（1184）与 `apps/daemon+apps/cli` 集成（63）全绿；`pnpm typecheck`/`lint`/`docs:check` 全绿。

## 6. 未验证 / 不确定

- **真实 macOS Keychain**：只经注入 runner 验证契约，未在真机跑 `/usr/bin/security`；`security` 的 argv 暴露按冻结说明接受。
- **WebUI/BFF 侧（`apps/web/**`、`provider.upsert`/`provider.test`）**：属他人进行中的 T1.2b 改动，本次按指示未纳入判定，也未验证设置页 API Key 端到端。
- **未执行的契约命令**：`pnpm install --frozen-lockfile`、`pnpm build`、`pnpm test:e2e`、`pnpm test:acceptance`、`pnpm test:live`（避免与并行 Agent 的 `scripts/**`、`package.json`、Playwright 安装互相干扰）。因此 AC-075/078 的端到端证据本轮未复验。
- **非 macOS/Linux 行为**：仅在 darwin 上执行。
- **规模/性能**：未测大量记录时的 `list()`/装载耗时。
- 坏记录的「真实来源」是我构造的（garbage 文件 / 真实 `keychain.json`）；未演练 `backup/restore` 是否会产生截断记录。

## 7. 复核意见（冻结决定是否按声明实现）

- **`apps/cli` 依赖 `@agentdev/core`（懒加载）**：✅ 按声明实现。`apps/cli/src/secret.ts:22` 是 `import type`（编译期擦除），运行时仅 `secret.ts:216 await import('@agentdev/core')`；`ARCHITECTURE.md` §2 的工作树版本已写入「core（仅安装级操作：secret/backup/restore/relocate，且按需懒加载）」，比冻结说明更早落地。
- **`secret.set/delete` 不入幂等账本、不持久化任何值的摘要**：✅ 代码表结构 + 集成测试 + 实测同键重放均已证实。
- **持久后端默认 `file`、Keychain 严格 opt-in、0600 AES-256-GCM + 0600 主密钥**：✅ 默认值与 0600/0700、原子写、错误主密钥拒绝均成立；但「Keychain 与 file 共用同一目录」这一未声明的实现细节带来 W12T1-01/02，属于本次要修的范围。
- **`config.get`/`agents` 的 `secretConfigured` = 「secretRef 存在且真的已注册」**：✅ 由实时 `SecretStore`/仓库计算（无缓存），语义变化未破坏任何既有消费者或测试。
- **注册 ≠ 授权；provider secret 仅 `gateway`；`tool` 仍需显式 grant；`SecretStore.resolve` 策略不变**：✅ 逐条成立（`secrets.ts` diff 仅为新增校验/删除入口）。
- 结论：**建议回 Develop 修 W12T1-01（必须），并同批处理 W12T1-02/03/04（建议）**；修复属小改（记录命名空间隔离 + 逐条容错加载 + ref/envName 边界校验 + 缺主密钥拒绝），修完需回到独立 Review 再测。

---

# 复核轮 2（T1.1 修复轮 2）

- 复核对象：上表同一组 T1.1 文件（`secret-repository.ts` 重写为命名空间 + 容错扫描；`main.ts` 装载/锁/`/health`；`protocol.ts` `secret.list` 形状与 `problems`；CLI `--stdin`/掩码；三份测试新增用例）。
- 基线：`HEAD=7c723ec` 不变，实现仍为工作树改动。修复记录位于 `.agentdev/work/WP-12/T1-implementation.md` §7–§9，**本轮未读**，全部结论来自代码 + 自跑。
- 干扰声明（重要）：另一路 Agent 在 16:16 之后修改了 `packages/core/src/execution.ts`（mtime 16:16:08）与 `packages/core/src/orchestrator.ts`（16:16:56），当前全仓 `pnpm typecheck`/`pnpm build` 因这两文件的 `TS2304 Cannot find name 'ProtocolError' / 'OperationName'` 失败；这**不是** T1.1 的改动（T1.1 的 9 个文件 diff 不含这两文件），我在 16:13:34 这两次编辑之前跑过全仓 `pnpm typecheck` 退出 0。`apps/web/**`、`scripts/**`、`tests/browser/**`、`package.json`、`pnpm-lock.yaml` 同样未纳入判定。
- 判定规则：任一 P0/P1/P2 可复现即 FAIL（本轮无）。

## 复核轮 2 结论

**PASS —— 上轮 1 条 P1（W12T1-01）与 4 条 P2 全部闭环；无新 P1/P2；新增 5 条 P3（均非阻塞）。**

## R2.1 逐条闭环证据（真实命令 + 退出码 + 关键输出）

### W12T1-01（上轮 P1）— 已闭环

原复现步骤亲自重跑，三种触发全部不再阻断启动，且损坏记录可见、使用时失败：

| 场景 | 命令 | 结果 |
|---|---|---|
| ① 旧共享布局：`secrets/keychain.json` + `secrets/garbage.json`（file 后端） | `node /tmp/wp12-cli-smoke.mjs secret list` → `start --root <repo>` | `LIST_EXIT=0`（`items` 1 条 `health:"ok"`、`problems: []`）；`START_EXIT=0`；daemon 日志 `loaded 1 secret(s)`；全程 `grep` 无值 |
| ② 命名空间内损坏文件 `secrets/file/garbage.json` | 同上 | `LIST_EXIT=0`，`items` 仍 1 条，`problems[0].code=SECRET_RECORD_INVALID` 且 `path` 指向该文件；`START_EXIT=0`；daemon 日志 `agentdevd: ignoring an unusable secret file (SECRET_RECORD_INVALID): …` |
| ③ 真实损坏记录（换掉 `master.key` 的 32 字节） | 同上 | `LIST_EXIT=0`，`items[0]={configured:false,health:"unreadable",issue:{code:"SECRET_DECRYPT_FAILED"}}`；`START_EXIT=0`；daemon 日志 `secret provider/main could not be loaded (SECRET_DECRYPT_FAILED): …` |

反向（不得假装已配置）在真实 daemon 上实测（`/tmp/wp12-probe-r2.mjs`）：

```
list=[{"ref":"provider/main","configured":false,...,"health":"unreadable","issue":{"code":"SECRET_DECRYPT_FAILED",...}}]
load={"loaded":0,"failed":[{...SECRET_DECRYPT_FAILED...}],"problems":[]}
store.has=false
resolve={"ok":false,"code":"NOT_FOUND","reason":"no secret is registered as provider/main"}
gatewaySecretResolver.resolve=undefined
```

代码落点：`secret-repository.ts:455-529`（`scan()` 逐文件容错，坏文件进 `problems`、不可解密进 `health:'unreadable'`）、`:290-346`（`loadSecretsIntoStore` 不抛、逐条 `failed`）、`apps/daemon/src/main.ts:195-244`（装载在 try 内、`failed`/`problems` 各记一条日志）、`apps/daemon/src/protocol.ts` 的 `listSecrets`（`items` + `problems`）。集成测试 `apps/daemon/test/secret.integration.test.ts:439-498` 覆盖 ①+③。

### W12T1-02（上轮 P2）— 已闭环（双向）

`/tmp/wp12-probe-r2.mjs` 实测：

```
layout=["file","keychain","master.key"]
afterKcSet={"fileList":["provider/fromfile"],"fileProblems":0,"kcList":["provider/fromkeychain"],"kcProblems":0}
afterKcDelete(fromfile)={"fileList":["provider/fromfile"],"kcList":["provider/fromkeychain"]}
afterFileDelete(fromkeychain)={"fileList":["provider/fromfile"],"kcList":["provider/fromkeychain"]}
file still readable=true
```

即 file 与 keychain 互不装载、互不上报、互不删除；旧共享布局文件连 `problems` 都不产生（不读取、不变慢）。落点 `secret-repository.ts:78-82, 216-227`（`secrets/file/`、`secrets/keychain/index.json`）。

### W12T1-03（上轮 P2）— 已闭环（先校验后写，失败无残留）

- 单测 `packages/core/test/secret-repository.test.ts:251-269`：`'a'.repeat(112)` 成功、`'a'.repeat(113)` 抛 `SECRET_VALUE_INVALID`，并断言 `readdirSync(fileDir) === [recordName(longest)]`（文件系统级，不是只看返回值）。
- 我的独立复现：`set('a'*113)` → `code=SECRET_VALUE_INVALID`、`fileDir="(no file dir)"`、`masterKeyExists=false`。
- 协议路径：`/rpc secret.set` 113 字符 ref → `422 VALIDATION_ERROR`，随后 `readdirSync(fileDir).length === 1`（只有先前成功的 `provider/boundary`），`running.secrets.refs()===["provider/boundary"]`。
- 落点 `secret-repository.ts:844-857`（`assertRef` 同时校验 `secretEnvName(ref).length ≤ MAX_SECRET_ENV_NAME_LENGTH`），`secrets.ts:196-198` 导出上界。

### W12T1-04（上轮 P2）— 已闭环（缺主密钥不重建）

```
refused=SECRET_MASTER_KEY_MISSING: the secret master key …/secrets/master.key is missing while records exist; …
valueInMessage=false
keyRecreated=false
fileDir=["687bb8fc…json"]      # 只有原有记录，没有被拒绝的那条
freshStoreKeyMode=0600          # 空库时正常创建
list()[0] = {"ref":"provider/main","health":"unreadable"}
```

单测 `secret-repository.test.ts:271-297`。报错文本只含路径/ref，不含值。

### 上轮 P3 清单闭环情况

| 上轮 P3 | 状态 | 证据 |
|---|---|---|
| `--stdin` 未实现 | ✅ | `secret set provider/main --stdin` → `EXIT_STDIN=0`、`configured:true`；`secret.ts:264-269`；CLI 测试 `:173-178` |
| daemon 路径失败未 redact | ✅ | `secret.ts:156-164` + `maskValue()`；两条 CLI 失败用例断言 `err` 不含值 |
| 记录 0644 读取时不修回 | ✅ | 实测 0644 → `get()` 返回值且 `mode=0600`；单测 `:147-155` |
| 符号链接跟随 | ✅ | 记录→文件、悬空链接、记录→目录 全部 `SECRET_RECORD_INVALID`；`master.key` 为链接 → `SECRET_MASTER_KEY_INVALID`；`O_NOFOLLOW`（`:88-89, 890-923`）；单测 `:157-176` |
| 失败启动残留 `daemon.lock` | ✅ | `AGENTDEV_SECRET_BACKEND=keyring` → `START_EXIT=1`（`START_FAILED: … must be "file" or "keychain"`），`ls` 无 `daemon.lock`/`runtime.json`；`main.ts:658-664` 释放锁 |
| admin `/health` 泄漏 `home` | ✅（部分） | `/healthz` 响应不含 `$AGENTDEV_HOME`（`contains home? 0`）；仍返回 `instances[].root`（见 R2-03） |
| `secret.*`/CLI 契约未进文档 | ✅ | `docs/architecture/protocol.md` §5 新增 `secret.set/delete/list` 行与安装级/账本/健康说明；`docs/architecture/reliability.md` §7 新增 `secret set/list/delete` 与持久化模型 |
| `runtime.ts` 注释指向实现记录 | ✅ | `grep T1-implementation apps/cli/src` 无命中 |
| 测试名/负例缺口（坏记录分支、browser 只测 set、tool audience、CLI 注释） | ✅ | 新增 `reports a corrupt record…`；`refuses a browser session…` 现同时覆盖 `list/delete` **并**断言安装调用者随后成功（`:406-421`）；`accepts a tool-audience secret and refuses an unknown audience`（`:424-436`）；CLI 注释改为「drives the repository directly」 |
| `secret.list` 的 `configured` 恒 true | ✅ | 现在 `unreadable` 记录 `configured:false`；`problems` 独立上报 |

## R2.2 新发现（本轮，均为 P3，不阻塞）

- **R2-01 Keychain 后端的 `health` 从不校验，且陈旧条目无法清除。** `KeychainSecretRepository.list()`（`secret-repository.ts:750-762`）只读元数据索引，恒返回 `health:'ok', configured:true`；当 Keychain 条目被外部删除后：`list()` 仍报 ok；`loadSecretsIntoStore` 因 `get()` 返回 `null` 而 **静默 `continue`**（`:327`），得到 `{loaded:0,failed:[],problems:[]}`，daemon 日志无任何提示；`delete(ref)` 在 `SECURITY_NOT_FOUND` 时提前 `return false`（`:739`），**不清理索引行**，于是 `secret.list` 永远显示该 ref、`agentdev secret delete` 永远报 `deleted:false`，用户无法通过 CLI 清掉它。file 后端则会在 `scan()` 里实际解密、报 `unreadable`，两者不对称。建议：`loadSecretsIntoStore` 对「list 有该 ref 但 get 为 null」补一条 `failed`（可诊断），并让 keychain `delete` 在条目已不存在时也移除索引行。
- **R2-02 `delete()` 遇到目录路径抛未类型化异常。** `FileSecretRepository.delete()`（`:442-448`）只判断 `fileKind !== 'missing'` 就 `rmSync(path, {force:true})`；若记录路径被替换成目录，实测抛 `SystemError ERR_FS_EISDIR`，`/rpc secret.delete` 会变成未类型化的 500（`get()`/`list()` 对同一路径给的是 `SECRET_RECORD_INVALID`）。建议复用 `assertReplaceable`/捕获后按 `SECRET_RECORD_INVALID` 抛出。
- **R2-03 admin `/health`/`/healthz` 仍返回项目 root 路径。** 已移除 `home`（上轮点名的项），但 `instances[].root` 仍是路径；`protocol.md` §5 的「不返回路径」指的是项目 daemon 的 `/healthz`（`apps/daemon/src/server.ts:147-149` 仍只回 `{version,ready}`），admin 面是 CLI 安装面且 `GET /projects` 本就返回 root，故仅登记不判缺陷。
- **R2-04 旧（修复轮 1）布局记录被静默忽略。** 实测把记录放到 `secrets/<hash>.json`（修复前布局）后：`list=["provider/new"]`、`problems=0`、`load.loaded=1`——旧 ref 完全不可见也无告警。影响：T1.1 在 `HEAD 7c723ec` 尚未发布，正式用户不存在此类记录；只有跑过中间构建的开发环境需要重新 `secret set`（新布局 `secrets/file/`）。无需迁移代码，但可在结算说明里注明。
- **R2-05 值上限文案与 admin 通道不一致。** `assertValue`（`:859-866`）接受恰好 65536 字符（实测 `/rpc` 65536 → 200、65537 → 422），但错误文案写「shorter than 65536 bytes」；同时 admin `POST /secret` 的 64 KiB **整体 body** 上限使 65536 字符的值无法经「daemon 在跑时的 CLI」写入（只有 `/rpc` 或 daemon 停止时直连仓库可以）。真实 API Key 远小于此，属文案/一致性小问题。

## R2.3 回归证据（本人实跑）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm typecheck`（16:13:34，另一 Agent 改 `execution.ts`/`orchestrator.ts` 之前） | 0 | 全仓 strict 通过 |
| `pnpm typecheck`（16:17，事后） | 1 | **仅** `execution.ts(224,230,233)`、`orchestrator.ts(236,245,264,265,328,329)` 的 `TS2304`；T1.1 文件 0 报错（外部干扰，见开头声明） |
| `pnpm exec prettier --check <15 个 T1.1 文件>` | 0 | `All matched files use Prettier code style!` |
| `pnpm exec eslint <15 个 T1.1 文件>` | 2 | `typescript-eslint does not support TS 7.0`（仓库工具链问题，与本改动无关；`pnpm lint` 仅跑 prettier） |
| `pnpm exec vitest run --project unit packages/core/test/secret-repository.test.ts` | 0 | 26 passed（上轮 17） |
| `pnpm exec vitest run --project integration apps/daemon/test/secret.integration.test.ts` | 0 | 10 passed（上轮 7） |
| `pnpm exec vitest run --project integration apps/cli/test/secret.integration.test.ts` | 0 | 5 passed（上轮 3） |
| `pnpm exec vitest run --project unit` | 0 | 60 files / **1193** passed（上轮 1184；含 `apps/web` 单测，`secretConfigured` 语义未破） |
| `pnpm exec vitest run --project integration apps/daemon apps/cli` | 0 | 8 files / **68** passed（上轮 63） |
| `pnpm exec vitest run --project integration packages/core` | 1 | 21 files / 201 passed / **1 failed**：`grants.integration.test.ts` 需要 `pnpm build`，而 build 当前因外部 `execution.ts` 失败（非 T1.1） |
| CLI 冒烟（直连仓库 + 真 daemon 子进程，`AGENTDEV_HOME` 临时目录） | 0 | `set/list/delete/start/stop` 全 0；`grep -rl <value> $AGENTDEV_HOME` 无命中；目录 0700、记录/主密钥 0600；daemon 日志无值 |
| 并发写者（6 进程，新布局） | 0 | 6/6 `OK`；`reads: r1..r6` 全部可读；`list` 6 条、`problems=0` |
| `/rpc` 边界探针 | — | 65536 → 200；65537 → 422；113 字符 ref → 422 且磁盘仅 1 条记录 |

`secretConfigured`/gateway 解析回归：`config.get` 与 `agents` 仍从实时 `SecretStore` 计算（`protocol.ts` 的 `secretRegistered`，回退分支改为 `health==='ok'`）；`secrets.ts` 的 `resolve/admit/scopeAllows` 未改动；`packages/core/test/secrets.test.ts` + `model-gateway.test.ts` 在全量 unit 中通过。

## R2.4 新测试的变异式判断（挑 3 条，给出「被哪条断言杀死」）

我保持只读（未真的改源码跑变异），判断基于断言结构 + 我在同一行为上的独立实跑：

1. `secret-repository.test.ts:301-312`（外来 `keychain.json`/垃圾文件不得进 file 命名空间）。变异：把 `scan()` 的 `this.paths.fileDir` 改回 `this.paths.dir` → `keychain.json`/`garbage.json` 会被解析，`expect(repository.problems()).toEqual([])` 立即失败（我的复现 ① 也证明读根目录会产生问题项）。**可杀死该变异。**
2. `:251-269`（超长 ref 先校验后写）。变异：删掉 `assertRef` 里的 `secretEnvName` 长度检查 → `set(tooLong)` 成功，`expect(readdirSync(fileDir)).toEqual([recordName(longest)])` 失败。断言落在文件系统上，不是只看返回值。**可杀死。**
3. `:271-289`（缺主密钥不得重建）。变异：删掉 `requireMasterKey` 里的 `if (this.hasRecords()) throw` → `set` 成功，`expect(() => statSync(masterKey)).toThrow()` 失败，且 `readdirSync(fileDir)` 断言也会失败。**可杀死。**
   另：`apps/daemon/test/secret.integration.test.ts:467-497` 的 `configured:false / health:'unreadable' / config.get false` 三条断言，只有「跳过坏记录且不进 store」这一种实现能同时通过；变异回「静默假装已配置」会使 `expect(running.secrets.has(...)).toBe(false)` 或 `secretConfigured=false` 失败。

仍未覆盖（沿用上轮登记的测试缺口，本轮未新增）：并发写者、恰好 65536 的值边界、CLI 进程 argv 断言。前两项我已用独立脚本实跑通过（见 R2.3），argv 由「值只来自 stdin」的结构保证。

## R2.5 本轮仍未验证

- 真实 macOS Keychain（只用注入 runner）；`security` 的 `-w <value>` argv 暴露仍按冻结说明接受。
- `pnpm build` / `pnpm test:e2e` / `pnpm test:acceptance` / `pnpm test:live` / `pnpm install --offline`：当前全仓 build 被外部 `execution.ts`/`orchestrator.ts` 阻断，未执行。
- `apps/web`（T1.2b）与 `provider.upsert` 端到端、WebUI 设置页 API Key 输入：未纳入本轮。
- 全量 `packages/core` 集成中的 `grants.integration.test.ts`：仅因外部 build 失败而失败，未单独复验。
- 非 darwin 平台、超大规模记录下的 `list()` 性能。

## R2.6 复核轮 2 意见

修复方向与上轮建议一致且落实到位：命名空间隔离 + 逐条容错 + `health:'unreadable'`/`problems` + 缺主密钥拒绝 + ref/envName 前置校验 + 锁释放 + 文档补齐 + 掩码对称。**上轮 1 P1 / 4 P2 全部可复现地关闭，无新 P1/P2，修复未破坏 `secretConfigured`、gateway 解析或既有 CLI/daemon 行为。** 新增 5 条 P3 建议在 T1.1 结算或后续任务中一并消化（其中 R2-01 的「list 有 ref 但 get 为 null 时不记录失败」最值得顺手补上，它和本轮刚建立的诚实健康语义直接相关）。判定：**PASS**，可进入独立 Test。
