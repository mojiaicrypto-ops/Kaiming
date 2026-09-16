# WP-12 macOS Keychain 真机验证记录

状态：**Completed**（本机 macOS 26.5.1，真实 `/usr/bin/security`；未提交 git）
依据：`docs/architecture/execution.md` §4、`docs/architecture/reliability.md` §7、`docs/operations/installation.md` §4

可复跑：

```sh
pnpm build
node .agentdev/work/WP-12/wp12-keychain-drill.mjs
AGENTDEV_KEYCHAIN_IT=1 pnpm vitest run --project integration \
  packages/core/test/secret-repository.keychain.integration.test.ts
```

- 完整原始输出（值一律掩码为 `<MASKED>`）：`.agentdev/work/WP-12/keychain-drill-output.txt`（303 行，45/45 检查通过）
- `security` 编解码探针原始输出：`.agentdev/work/WP-12/keychain-decode-probe-output.txt`
- 单元测试原始输出：`.agentdev/work/WP-12/keychain-unit-output.txt`
- opt-in 集成测试原始输出（默认跳过 + `AGENTDEV_KEYCHAIN_IT=1`）：`.agentdev/work/WP-12/keychain-it-output.txt`

## 0. 结论

Keychain 后端此前只有注入 `SecretCommandRunner` 的契约测试，从未在真机跑过 `security`。本次用**随机 item 前缀 + 临时 `AGENTDEV_HOME` + 临时 Git 项目 + 真 daemon + 回环桩 Provider** 做了端到端验证，结论：

1. `set → get` 真机往返一致（ASCII、非 ASCII、控制字符三类）；`list` 只回元数据；`delete` 真删；覆盖写即轮换。
2. 缺 ref 走文档化行为（`get` 返回 `null`；`rotate` 报 `SECRET_NOT_FOUND`）；索引行与 Keychain 项不一致时逐条上报 `missing`/`unreadable` 与 `problems`，不再被静默跳过；损坏索引不阻断 `list()`。
3. 值不进入 CLI 自身 argv、stdout/stderr、`AGENTDEV_HOME` 文件、仓库工作树或 daemon 日志。
4. **发现并修复一个真实缺陷 D-1：非 ASCII 值的解码错配**（详见 §3）。
5. 发现并如实登记两项平台/设计限制（未擅自改产品行为）：`security -w <value>` 的 argv 暴露（§4.1）、Keychain 条目按用户而非 `AGENTDEV_HOME` 隔离（§4.2）。

## 1. 隔离方式与清理

- 隔离：每次运行生成随机前缀 `wp12verify-<10 hex>`，所有 ref 形如 `<prefix>/...`，与操作者真实凭据不可能重名；`AGENTDEV_HOME` 指向 `mkdtemp` 临时目录；daemon 用临时 Git 项目。
- 清理：脚本退出（含异常路径）调用 `security delete-generic-password` 删除本次创建的全部 account，并 `rm -rf` 四个临时目录；文档化命令 `security find-generic-password -a <ref> -s agentdev-secret` 逐个复核返回 44。
- 清理实测（脚本 §D 原样）：

```text
deleted 4 created Keychain item(s) with `security delete-generic-password`
  provider:01a0a9a9-1a7d-7a3d-a083-420db383373d -> security find-generic-password exit 44 (44 = not found)
  wp12verify-569ad64c60/provider-argv -> security find-generic-password exit 44 (44 = not found)
  wp12verify-569ad64c60/provider-cli -> security find-generic-password exit 44 (44 = not found)
  wp12verify-569ad64c60/provider-cli2 -> security find-generic-password exit 44 (44 = not found)
  wp12verify-569ad64c60/provider-main -> security find-generic-password exit 44 (44 = not found)
  wp12verify-569ad64c60/provider-ps -> security find-generic-password exit 44 (44 = not found)
  wp12verify-569ad64c60/stale -> security find-generic-password exit 44 (44 = not found)
  wp12verify-569ad64c60/unicode -> security find-generic-password exit 44 (44 = not found)
ok   D every created Keychain item is gone from the login keychain — 0 leftover(s)
ok   D no value appears anywhere under the temp installation homes
removed temp dirs: agentdev-wp12-kc-hQG73Y, agentdev-wp12-kccli-ufFK0O, agentdev-wp12-kcdaemon-QhaTAy, agentdev-wp12-kcrepo-dsuxWz
ok   D the temp installation dirs are gone
# Result: ALL CHECKS PASSED
```

> 第一次演练在 C2（daemon 重启后立即 RPC）撞到 `ECONNRESET` 竞态并中断；已把 `rpc` 改为对传输层错误重试，并注册 `process.on('exit')` 清理钩子，随后两次完整运行均全绿且无残留（见 §5）。

## 2. 真机演练原始输出（节选）

完整输出见 `keychain-drill-output.txt`；下列均为其中原样行，仅值被掩码。

### 2.1 A 段：仓库层（built `@agentdev/core` + 真 `security`）

```text
ok   A1 set uses the keychain backend and reports metadata only — {"ref":"wp12verify-569ad64c60/provider-main","configured":true,"updatedAt":"2026-09-16T10:00:19.214Z","backend":"keychain","health":"ok"}
ok   A1 get resolves exactly the stored value
ok   A2 list reports one metadata row with health=ok — [{"ref":"wp12verify-569ad64c60/provider-main","configured":true,"updatedAt":"2026-09-16T10:00:19.214Z","backend":"keychain","health":"ok"}]
ok   A2 list carries no value
    index bytes = "{\n  \"v\": 1,\n  \"entries\": [\n    {\n      \"ref\": \"wp12verify-569ad64c60/provider-main\",\n      \"audience\": \"gateway\",\n      \"updatedAt\": \"2026-09-16T10:00:19.214Z\"\n    }\n  ]\n}"
ok   A3 a non-ASCII value round-trips through the real Keychain — expected-length=21 read-length=21
ok   A4 overwriting an existing ref keeps one row and the newest value
ok   A4 the raw Keychain item holds the newest value
ok   A5 delete removes the Keychain item and its index row
ok   A5 deleting an absent ref is an honest false
ok   A6 get of an absent ref returns null (documented)
ok   A7 a stale index row is reported health=missing with SECRET_NOT_FOUND — {"ref":"wp12verify-569ad64c60/stale","configured":false,...,"health":"missing","issue":{"code":"SECRET_NOT_FOUND",...}}
ok   A7 the stale row is also reported through problems() — [{"path":".../secrets/keychain/index.json","code":"SECRET_NOT_FOUND",...}]
ok   A7 startup load counts the stale ref as failed, not as loaded — {"loaded":1,"failed":[{"ref":"wp12verify-569ad64c60/stale","code":"SECRET_NOT_FOUND",...}],"problems":[...]}
ok   A7 delete converges the stale row instead of hiding the ref forever
ok   A8 a corrupt index is reported as a problem, list() stays non-throwing — [{"path":".../secrets/keychain/index.json","code":"SECRET_RECORD_INVALID","message":"... is not valid JSON"}]
ok   A9 no value appears in any file under the installation home
ok   A9 no value appears in the repository working tree
```

A7 的“索引行在、Keychain 项被人工删掉”是真机复现的缺项场景；`health:missing`（`SECRET_NOT_FOUND`）进入 `problems`，`loadSecretsIntoStore` 计 `failed` 而非 `loaded`，`delete` 收敛索引行。A8 把 `index.json` 写成非 JSON：`list()` 返回 `[]` 且 `problems()` 给 `SECRET_RECORD_INVALID`，不抛、不阻断。

### 2.2 B 段：`agentdev` 构建产物真命令

```text
$ agentdev secret set wp12verify-569ad64c60/provider-cli <standard input>
{"ok": true, "path": "repository", "backend": "keychain", "ref": "wp12verify-569ad64c60/provider-cli", "configured": true, "updatedAt": "..."} [exit 0]
ok   B1 set exits 0 and reports the repository path on the keychain backend
ok   B1 the value is absent from stdout and stderr
ok   B1 the raw Keychain item holds the value
ok   B2 a non-ASCII CLI value is stored and read back unchanged by the repository — expected-length=17 read-length=17
$ agentdev secret list
{ "ok": true, "path": "repository", "backend": "keychain", "items": [ { "ref": "...provider-cli", "configured": true, "backend": "keychain", "health": "ok" } ], "problems": [] } [exit 0]
ok   B3 list reports metadata only and names the ref
ok   B3 list never carries the value
$ agentdev secret rotate wp12verify-569ad64c60/provider-cli <standard input>
{ "ok": true, "command": "secret rotate", "path": "repository", "rotated": true, "previousUpdatedAt": "...", "updatedAt": "...", "atomicSwap": true, ... } [exit 0]
ok   B4 rotate replaces an existing ref atomically
ok   B4 rotate output never carries the value
ok   B5 set over an existing ref overwrites it
$ agentdev secret rotate wp12verify-569ad64c60/never-registered <standard input>
{"ok":false,"error":{"code":"SECRET_NOT_FOUND","message":"没有已注册的凭证 ...；首次录入请用 agentdev secret set ..."},"operationId":"..."} [exit 1]
ok   B6 rotate of an unregistered ref reports the documented SECRET_NOT_FOUND
ok   B6 the refused rotate never echoes the value
$ agentdev secret delete wp12verify-569ad64c60/provider-cli
{"ok": true, "path": "repository", "ref": "...", "deleted": true} [exit 0]
ok   B7 delete removes the Keychain item
ok   B7 deleting again reports deleted=false
ok   B8 the CLI process argv never contains the value (value comes from stdin) — 42231 /opt/homebrew/.../node .../apps/cli/dist/cli.js secret set wp12verify-569ad64c60/provider-argv
ok   B8 the blocked CLI finished and stored the value
ok   B9 the platform limitation is real: `security` argv carries the value (documented, opt-in only) — /usr/bin/security add-generic-password -a wp12verify-569ad64c60/provider-ps -s agentdev-secret -w <MASKED> -U
```

B8 让 `secret set <ref>` 阻塞在 stdin 上再从 `ps` 读该进程 argv：argv 只有 `... cli.js secret set <ref>`，**不含值**（值由 stdin 读入，argv 在 exec 后不可变），随后送入值并确认写库成功。B9 用重复调用 + 采样 `ps` 真机复现了 `security -w <value>` 的 argv 暴露（见 §4.1）。

### 2.3 C 段：真 daemon + 回环桩 Provider（gateway 解析）

```text
loopback stub Provider: http://127.0.0.1:52377/v1
provider.upsert -> {"status":"applied","providerId":"01a0a9a9-...","version":1,"secretConfigured":true}
secretRef=provider:01a0a9a9-...
ok   C1 provider.upsert reports the credential as configured
ok   C1 the daemon wrote the credential to the real Keychain
ok   C1 the live gateway resolves the keychain credential for the probe — stub saw ["Bearer <MASKED>"]
ok   C2 after a restart the gateway resolves the credential loaded from the real Keychain — stub saw ["Bearer <MASKED>"]
ok   C3 the CLI registers against the live daemon through its admin surface — { "path": "daemon", "backend": "keychain", ... }
ok   C3 the real Keychain holds the rotated value
ok   C3 the live gateway resolves the rotated credential immediately — stub saw ["Bearer <MASKED>"]
ok   C4 the credential never appears in the daemon log or the installation home
ok   C5 deleting the keychain credential removes the real Keychain item
```

- C1：走设置页路径 `provider.upsert(secret)`，daemon 自己把值写进真 Keychain 与内存 store；`provider.test` 探针打到回环桩，桩记录 `Authorization: Bearer <值>`。
- C2：`stop` → `start` 后再次 `provider.test`，值只可能来自**启动时从真 Keychain 的装载**，桩仍收到同一凭据。
- C3：daemon 运行时用 `agentdev secret set <ref>` 轮换，CLI 报 `path:"daemon"`（回环 admin 面），真 Keychain 变为新值，下一次探针立即解析到新值。

## 3. 缺陷 D-1：`security -w` 非 ASCII 值解码错配（已修复）

### 3.1 复现（真机，探针输出见 `keychain-decode-probe-output.txt`）

`security find-generic-password -w` 只在值为**可打印 ASCII** 时原样输出；一旦值含非 ASCII 或控制字节，就输出**十六进制编码**。修复前仓库把该 hex 直接当值返回：

```text
in=[sk-abc123]
  -w -> [sk-abc123]
  -g -> [password: "sk-abc123"]
in=[abcdef0123456789]      <- 纯 ASCII 的“像 hex”值必须保持原样
  -w -> [abcdef0123456789]
  -g -> [password: "abcdef0123456789"]
in=[é]
  -w -> [c3a9]             <- 修复前会被当成字符串 "c3a9" 返回
  -g -> [password: 0xC3A9 ]
in=[🔑]
  -w -> [f09f9491]
  -g -> [password: 0xF09F9491 ]
in=[a
b]
  -w -> [610a62]
  -g -> [password: 0x610A62  "a\012b"]
```

歧义点：一个本身就是 `[0-9a-f]` 偶数字符的 ASCII 值（如 `c3a9`）与 `é` 的 hex 编码在 `-w` 下不可区分，因此不能只凭 `-w` 猜测。

### 3.2 修复

`packages/core/src/secret-repository.ts`：`get()` 改为经 `readKeychainValue()` 读取。`-w` 结果形如“非空、偶数长度、全 `[0-9a-fA-F]`”时，再调一次 `security find-generic-password -g`：`-g` 对可打印数据输出 `password: "…"`、对其它输出 `password: 0x…`，据此判定是原值还是 hex 并还原字节。`-w` 已成功而 `-g` 失败时报 `SECRET_KEYCHAIN_FAILED`（绝不返回错误字节）。`list()/scan()` 只探活不取值，未改；宽容装载与 `problems` 语义原样保留。

### 3.3 验证

- 单元：`packages/core/test/secret-repository.test.ts` 新增假 runner 精确复刻真 `security` 的 `-w`/`-g` 形态，断言 `值é🔑-token`、`line1\nline2` 往返一致且 `c3a9` 保持原样。
- 真机：A3（非 ASCII 往返长度 21）、B2（CLI 非 ASCII 长度 17）全绿——修复前 B2 必失败。
- opt-in 集成：`secret-repository.keychain.integration.test.ts` 的“ASCII/非 ASCII/控制字节/像 hex 的 ASCII”四类真机往返。

## 4. 已登记限制（真机验证，未擅自改产品行为）

### 4.1 `security` 子进程 argv 暴露值（平台限制，已实测）

`security add-generic-password -w <value>` 把值放进子进程 argv；B9 采样 `ps -axww` 捕捉到：

```text
/usr/bin/security add-generic-password -a wp12verify-569ad64c60/provider-ps -s agentdev-secret -w <MASKED> -U
```

CLI 自身进程 argv 不含值（B8），值只从 stdin 读。该限制在不引入原生依赖（直接调 Security.framework）的前提下无法消除，因此 `keychain` 保持严格 opt-in、默认 `file`。已写入 `installation.md` §4 与 `reliability.md` §7。

### 4.2 Keychain 条目按用户共享，不按 `AGENTDEV_HOME` 隔离（已登记缺口）

条目位于登录钥匙串（`service=agentdev-secret`、`account=<ref>`），与 home 无关；同一用户的两个安装若用相同 ref 会读写同一条目（`file` 后端按 home 隔离）。未单方面改为“按 home 派生 service/account”，因为那会改变已文档化的条目布局与人工运维命令，属产品行为变更，需确认。已在 `installation.md` §4/§11 与 `reliability.md` §7 登记。

### 4.3 真机 unreadable 分支未直接制造

“索引行在而 Keychain **非 44** 读取失败 → `health:unreadable` + `SECRET_KEYCHAIN_FAILED`”由注入 runner 的单测与 opt-in 集成覆盖，未在真机复现（需临时锁定/替换登录钥匙串，风险与侵入性高）。真机复现的是 `missing` 分支（§2.1 A7）。

## 5. 门禁与测试证据

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0（先对新增测试执行 `prettier --write`） |
| `pnpm test:unit` | 80 文件 / 1494 用例全通过（含 `secret-repository.test.ts` 30 用例） |
| `pnpm vitest run --project integration packages/core/test/secrets.integration.test.ts` | 5/5 |
| `pnpm vitest run --project integration apps/cli/test/secret.integration.test.ts` | 8/8 |
| `pnpm vitest run --project integration apps/daemon/test/secret.integration.test.ts` | 10/10 |
| `pnpm vitest run --project integration packages/core/test/secret-repository.keychain.integration.test.ts` | 默认 6 skipped；`AGENTDEV_KEYCHAIN_IT=1` 时 6/6 |
| `pnpm docs:check` | ok：16 documents / 68 links / 94 acceptance / 9 requirements / 11 work packages |
| `node .agentdev/work/WP-12/wp12-keychain-drill.mjs` | 45/45 检查通过 |

未运行完整验收套件（`pnpm test:acceptance`/e2e/browser）：另一条 lane 正占用；如需全量验收由主 agent 决定。

opt-in 集成测试设计（`packages/core/test/secret-repository.keychain.integration.test.ts`）：仅当 `AGENTDEV_KEYCHAIN_IT=1` 且 `process.platform==='darwin'` 且 `/usr/bin/security` 存在、且对不可能存在的 account 查询返回 44（钥匙串可非交互使用）时才运行；否则整体 skip，普通 `pnpm test:integration` 不写操作者钥匙串。运行后用 `afterAll` 直接 `security delete-generic-password` 清理全部 account，断言失败也不残留。随机 ref 前缀避免重跑冲突。

## 6. 变更文件

- `packages/core/src/secret-repository.ts`：缺陷 D-1 修复（`readKeychainValue`/`decodeHexValue` + 两个 helper）。
- `packages/core/test/secret-repository.test.ts`：新增真机形态假 runner 回归用例。
- `packages/core/test/secret-repository.keychain.integration.test.ts`：新增 opt-in 真机集成测试（6 用例）。
- `docs/operations/installation.md` §4/§11/§12：macOS Keychain 实操、条目位置、人工查看/删除、argv 限制、跨安装共享、opt-in 测试。
- `docs/architecture/execution.md` §4、`docs/architecture/reliability.md` §7：把“Store 在 macOS 使用 Keychain”更正为“默认全平台 0600 文件、macOS 显式 opt-in Keychain”，并写明条目按用户存于登录钥匙串。
- `.agentdev/work/WP-12/wp12-keychain-drill.mjs`：真机演练脚本（可复跑）。
- `.agentdev/work/WP-12/keychain-drill-output.txt`、`keychain-decode-probe-output.txt`、`keychain-unit-output.txt`、`keychain-it-output.txt`：原始证据。
- 本文件。

未新增运行时依赖；未 `git commit`。

## 7. 余项

1. 4.2 的跨安装隔离若需收敛，建议方案是“account 加安装命名空间”（保持 `service` 不变、人工命令改带安装前缀）或明确文档化为“Keychain 后端为单用户单安装假设”——需产品确认后另开切片。
2. 4.3 的 `unreadable` 真机分支可在 Linux/CI 不覆盖；若要求真机覆盖，需要一次可控的钥匙串锁定演练，建议独立切片并限定影响面。
3. 全量验收套件未跑（另一 lane 占用），由主 agent 决定是否补跑。
