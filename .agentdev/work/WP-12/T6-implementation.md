# WP-12 T6 实现记录（运维与安装）

- 状态：Developing（CLI / 文档 / 模板 / 真实演练完成；缺见 §7）
- 依据：`.agentdev/work/WP-12/plan.md` §2 DoD 7、§4 T6 行；`.agentdev/work/WP-12/T6-plan.md`；
  `docs/architecture/reliability.md` §7/§8；`docs/architecture/ARCHITECTURE.md` §4/§5；
  `docs/architecture/protocol.md` §5；`docs/delivery/acceptance.md` AC-064/065/023–027/078。
- 范围：`apps/cli/**`、`apps/cli/templates/**`、新增安装文档、`apps/cli/test/**`、
  `.agentdev/work/WP-12/T6-*`。**未改** `packages/**`、`apps/daemon/**`、`apps/web/**`、
  `scripts/**`、`tests/**`、`docs/delivery/implementation.md`、`docs/product/*`。

## 1. 变更清单

| 文件 | 变更 |
|---|---|
| `apps/cli/src/ops.ts` | 新增：`backup`/`restore`/`relocate` 三个安装级操作，懒加载 `@agentdev/core`（`backup` 另需 `ProjectStore`）；逐条实现 §8 的拒绝与恢复顺序；失败统一 `error.code + operationId`，成功打印真实做过的事 |
| `apps/cli/src/cli.ts` | 命令分发 + USAGE 增三条；`stop/open/start` 的 `runtime.json` 读取改为「不可读 → `RUNTIME_RECORD_INVALID` + operationId」（WP-11 遗留：`runtime.json` 中间态曾让 `start` 无 operationId 崩溃） |
| `apps/cli/src/runtime.ts` | `waitForRuntime` 容忍契约不符的记录并轮询（daemon 在 admin 监听绑定前会先写 `admin.port=0` 的记录），到截止仍不可读才抛；`waitForStop` 对不可读记录继续等待 |
| `apps/cli/src/secret.ts` | 未改（T1.1 已交付；本切片复用其 lazy-core 模式与失败形状） |
| `apps/cli/package.json` + `pnpm-lock.yaml` | 新增 workspace 依赖 `@agentdev/storage`（`backupProject` 需要 `ProjectStore`；非第三方新依赖，`better-sqlite3` 本就在 core 依赖闭包内）；`ARCHITECTURE.md` §2 的 `apps/cli` 允许依赖列同步加 `storage` |
| `apps/cli/templates/com.agentdev.daemon.plist` | 安装/卸载步骤改为 `launchctl bootstrap/bootout`；写明 `__AGENTDEV_HOME__/logs` 必须先存在（launchd 启动前就打开 `StandardOutPath`），并指向本演练脚本 |
| `apps/cli/templates/agentdev.service` | 写明 `__NODE__` 必须是绝对路径、卸载步骤；注明该单元未在 macOS 上执行 |
| `apps/cli/test/ops.integration.test.ts` | 新增 9 例集成测试：backup 正例/拒绝、restore 正例/清单拒绝/缺凭证阻断与恢复、relocate 正例/同仓拒绝/短写、真实 daemon 下的活动 Project 拒绝 |
| `apps/cli/test/runtime.integration.test.ts` | 新增 1 例回归：不可读 `runtime.json` 下 `status`/`stop` 报 `RUNTIME_RECORD_INVALID` + operationId，`start` 接管并重写 |
| `docs/operations/installation.md` | 新增《安装与运维》（已执行过的步骤：安装/首次运行/凭证/备份/恢复/迁移/升级/用户服务/卸载） |
| `docs/INDEX.md` | 注册新文档；把「backup/restore/relocate CLI 面未交付」改为已交付并补 T6 段 |
| `.agentdev/work/WP-12/T6-{plan,drill.mjs,launchd-drill.sh,drill-output.txt,launchd-output.txt,implementation}.md` | 计划、可复跑演练脚本与原始输出、本记录 |

## 2. 命令面（决策记录）

`reliability.md` §7 已固定名字，按它实现；任务书里的简写作为别名/简写同时接受：

| 命令 | 形状 | 说明 |
|---|---|---|
| backup | `agentdev backup [<projectId>] --output <dir> [--out <dir>] [--root <path>] [--replace]` | 文档形状 `backup <projectId> --output <dir>`；`<projectId>` 可省略（安装内唯一 Project 时解析），`--out` 为别名 |
| restore | `agentdev restore <backupDir> [--root <path>] [--replace]` | `--root` 省略时用清单的 `canonicalRoot` |
| relocate | `agentdev relocate <projectId> --root <path> [--move]`；也接受 `relocate <newRoot> [--move]` | 新根不是 32hex id 时按新根解析 Project |

实现路线：三条命令都走 `@agentdev/core` 的安装级服务（`backupProject`/`restoreProject`/`relocateProject`），与 `secret.ts` 相同的懒加载；**不经过 daemon**，因为恢复正是 daemon 起不来时的路径，且 daemon 的 `restore.run` 使用 `<targetDir>/state` 便携布局、与安装的 `~/.agentdev/projects/<projectId>` 布局不同。canonical root 映射分两层：Project 行由 core 改写，安装级 `projects.json` 由 CLI 用 core 的 `registerProject`/`unregisterProject` 改写。

## 3. 真实演练（原始输出见 `T6-drill-output.txt`，可复跑 `node .agentdev/work/WP-12/T6-drill.mjs`）

`DRILL PASS`，进程退出码 0。演练用临时 `AGENTDEV_HOME` 与临时 Git 项目，未触碰真实 `~/.agentdev`。

**3.1 真数据（真实 daemon + 真实 Run）**：`agentdev start --root <repo>` 退出 0；经 daemon `/rpc` 的
`provider.upsert`（先注册无凭证 Provider，原因见 §7 G1）+ `config.save` 设 chief Profile，再 `conversation.message.send`：

```
conversation.message.send -> messageId=01a09f68-0f5c-709a-bfa6-210e3d103a76 workId=01a09f68-0f5c-751a-93bd-b776b51c453c
runs -> [{"id":"01a09f68-1008-7ec1-b907-ab2f60252975","role":"chief","status":"running"}]
ok   a real Run is running through the product path — 01a09f68-1008-7ec1-b907-ab2f60252975
```

daemon 日志同刻：`prepare-run: 01a09f68-1008… attempt 01a09f68-11f0… → 01a09f68-0e9d…/t6-drill-model`、
`supervisor: 01a09f68-1008… attempt 01a09f68-11f0… started (pid 53081, epoch 1)`。模型桩收到 0 次请求：Attempt
在第一次模型往返前就被备份/停止，Run 处于 `running` 即为「活动 Run」的证据。

**3.2 backup（daemon 与 Run 都在运行）** `agentdev backup --output <dir>` 退出 0：`complete:true`、
`revision=2e738840…`、`knowledgeFiles=1`、`files=4`、`secretRefs=["provider:01a09f68-1227-…"]`、`paused:false`，
警告 `PAUSE_NOT_IMPLEMENTED`、`PROJECT_OPEN_WHILE_BACKUP`。

**3.3 损坏**：`agentdev stop` 退出 0；删除 `~/.agentdev/projects/<projectId>` 与整个项目目录（脚本打印两行 `ok … is gone`）。

**3.4 restore** `agentdev restore <backup> --root <repo>` 退出 0：

```
"status": "ready",
"consistency": { "filesVerified": 4, "blobsVerified": 1, "knowledgeVerified": 1, "treeMatches": true, "knowledgeMatchesTree": true },
"recovery": { "parked": [{ "runId": "01a09f68-1008…", "from": "running", "to": "interrupted", "path": ["running","interrupted"] }],
              "interruptedRunIds": ["01a09f68-1008…"], "revokedLeases": 0, "revokedGrants": 0 },
"doctor": { "ok": true, "executionReady": true, "checks": [project-row, state-directory, sqlite-integrity, delivery-ref, tree-binding, knowledge-clean, evidence, leases-revoked, capabilities-revoked] },
"registryUpdated": true, "daemonOpenable": true
```

脚本随后断言：Git `HEAD` 恢复为备份 revision；重开 SQLite 得 `projects=1 works=1 messages=1`、该 Run `interrupted`、无活动租约、无未消费 Grant；`agentdev start` 退出 0、`agentdev status` `running:true`、`agentdev doctor` 退出 0（`execution ready: yes`）。

**3.5 缺凭证阻断**：用同一个备份恢复到**没有该凭证的临时安装**：

```
"status": "blocked", "provider": { "blocked": true, "missingSecretRefs": ["provider:01a09f68-1227-…"] },
"doctor": { "executionReady": false }, "nextSteps": ["agentdev secret set provider:01a09f68-1227-…   # 值从 stdin 读入"]
```

**3.6 relocate** `agentdev relocate <projectId> --root <newRoot> --move` 退出 0：仓库被移动、`projects.json` 指向新 root、
Project 行 root/gitRoot 改写、租约回收、doctor ok。**但** CLI 同时给出（见 §7 G2）：

```
relocate（**收尾轮 1 前的行为，已被取代**）：derivedProjectId=07884ad79f666c22bf30d74c75dbd0f5 daemonOpenable=false
relocate warning PROJECT_ID_DERIVED_FROM_ROOT: 新 root 派生出的 projectId=07884ad7…，与安装记录的 1115b039… 不同；daemon 下次在该 root 启动会派生新状态目录 …/projects/07884ad7…，迁移后的状态仍在 …/projects/1115b039…
GAP  relocate: the daemon reopened the moved root as a NEW project 07884ad79f666c22bf30d74c75dbd0f5 (works=0); the migrated state with its rows stays at …/projects/1115b039670747deee2f13cd41f238b2
```

状态目录实测：`1115b039…`（迁移前身份）`projects=1 works=1 runs=["interrupted"]`；`07884ad7…`（daemon 重启后按新 root 派生）`projects=1 works=0 runs=[]`。

## 4. 用户服务模板（macOS 真机；原始输出见 `T6-launchd-output.txt`）

`bash .agentdev/work/WP-12/T6-launchd-drill.sh` 退出 0：临时 label `com.agentdev.daemon.t6drill` + 临时 `AGENTDEV_HOME`，
用 `sed` 把模板占位符替换到临时目录，`launchctl bootstrap gui/501 <plist>` → `launchctl print` 显示
`state = running` 与真实 `program/arguments`，`agentdev status` 退出 0 且 `running:true`，daemon pid 与 `runtime.json` 一致，
`daemon.lock` 存在；`launchctl bootout gui/501/<label>` 后：无残留进程、无残留 `daemon.lock`、`launchctl print` 已无该 job、
`agentdev status` 为 `running:false`。真实 `~/Library/LaunchAgents` 未被写入（演练副本只在临时目录）。
`agentdev.service`（systemd）在本机未执行，只做静态核对（同一 daemon 入口、同一 `--home`、绝对路径要求），见 §7 G6。

## 5. 工程命令证据（真实退出码）

| 命令 | 结果 | 退出码 |
|---|---|---|
| `pnpm typecheck` | 首轮仅 `apps/daemon/test/provider-config.integration.test.ts` 报 9 处 `PlanDraft`/`SecretResolution` 类型错误（另一 Agent 在飞的 `apps/daemon/**`，非本切片文件）；协调后复跑 | 首轮 1（归因他方）→ **0** |
| `pnpm lint` | `All matched files use Prettier code style!` | 0 |
| `pnpm test:unit` | 63 文件 / 1247 用例 passed | 0 |
| `pnpm test:integration apps/cli` | 5 文件 / 37 用例 passed（含 `ops.integration.test.ts` 9 例） | 0 |
| `pnpm test:integration`（全量） | 34 文件 / 358 用例 passed | 0 |
| `pnpm docs:check` | `16 documents, 63 internal links, 94 acceptance cases, 9 requirements, 11 work packages` | 0 |
| `pnpm build` | 全部工程 Done | 0 |
| `node .agentdev/work/WP-12/T6-drill.mjs` | `DRILL PASS` | 0 |
| `bash .agentdev/work/WP-12/T6-launchd-drill.sh` | 8 项 `ok` | 0 |

## 6. AC-064 / AC-065 证据

- **AC-064（备份恢复）**：① 既有 core 集成测试 `packages/core/test/backup.integration.test.ts`（新目录 restore、篡改/不完整拒绝、缺 Secret 阻断、relocate）保持通过（全量集成 358 用例）。② 本切片新增**安装级真实演练**：真实 daemon + 真实 Chief Run → `agentdev backup` → 删安装状态与项目 → `agentdev restore` → daemon 重启 → doctor 通过；断言 SQLite 行（project/work/message）、Git revision、`treeMatches`、租约/Grant 归零、原活动 Run `interrupted`、`projects.json` 映射；③ 新增 9 例 CLI 集成测试覆盖四条拒绝（活动 Project、非空目标、清单缺失/不完整/版本不支持、缺凭证阻断）与带证据 blob 的恢复。**证据：本记录 §3 + `T6-drill-output.txt` + `apps/cli/test/ops.integration.test.ts`。**
- **AC-065（Migration）**：T6 未改迁移实现；`agentdev start` 打开时迁移并在状态目录旁生成一致性备份（既有行为），升级步骤已写入 `docs/operations/installation.md` §8。演练中的 restore 属恢复、不是迁移；AC-065 的既有证据不变（不因本切片升格也不降格）。
- **AC-023～027（注册/打开）**：安装文档写明 projectId = `SHA256(canonicalRoot)[0:32]` 与 `projects.json` 映射；演练证明同一 canonical root 的注册/恢复映射与 `agentdev open`/`start` 路径一致（§3.4）。AC-023/024/025/026/027 的既有证据不变。
- **AC-078（认证生命周期）**：文档新增「读取 installation token 并登录 WebUI」的具体步骤；CLI 侧 `runtime.json` 不可读时改为 `RUNTIME_RECORD_INVALID` + operationId（新增回归测试），未改认证实现。

## 7. 缺口（按严重度）

**G1（P1，阻塞真实 Provider 执行；屬 `apps/daemon`+`packages/core`，非本切片文件）**：Provider 带 `secretRef` 时，
`conversation.message.send` 不会入队 Chief Run。daemon 日志实测：`message.send: could not queue the Chief
assessment: role chief has no usable model: secret provider:01a09f5e-… is not available`
（栈：`Orchestrator.currentProfileRevision` → `ModelGateway.availability` →
`gatewaySecretResolver(store, SecretContext.context)` → `SecretStore.resolve`）。原因：可用性检查发生在任何 Grant 之前，
而 `SecretContext` 默认 `grants: []`，`SecretStore.resolve` 又要求 `secret` 操作的 Grant；`agents.md` §5 / WP-12 D3
的意图是「Provider secret 只对 gateway audience 生效（注册即对 gateway 可用）」。影响：真实 API Key 下任何 Run 都排不出来
（本演练因此把 live Provider 注册为无凭证，另注册一个带凭证 Provider 只为让备份记录 `secretRef`）。建议：gateway 解析
Provider 凭证走 audience 判定而非 tool Grant（或让 `availability` 使用该 Run 的授权上下文）。**需 T1/T2 归属 Agent 处理。**

**G2（P1，运行时身份）— 已登记缺口，由「项目身份持久化」切片关闭**：`relocate` 到不同 canonical root 后，daemon 由 root 重新派生 projectId（`ARCHITECTURE.md` §4），
于是在新状态目录新建一个空 Project，迁移后的状态（`~/.agentdev/projects/<旧 id>`）成为孤儿——实测 `works=0` vs `works=1`。
**收尾轮 1 起 CLI 改为 fail-closed**：目标派生不同 projectId 时以 `PROJECT_IDENTITY_MOVE_UNSUPPORTED` 拒绝且不移动、不改写；
只有解析到同一 canonical root 的目标（路径别名）才接受。修复需 daemon 依注册表别名解析 projectId 或 relocate 迁移身份
（`event` 表 UPDATE 被触发器禁止，故 CLI 无法自行改写）。

**G3（P2，§8 暂停语义）**：`reliability.md` §8 的「backup 将 Project 暂停到一致检查点、暂停新集成」在 daemon 无入口，
CLI 也无从暂停。现实现用 SQLite `VACUUM INTO` 在线一致快照 + 交付 ref 的 Git bundle + 当时工作树的知识树，成功输出
`paused:false` 与 `PAUSE_NOT_IMPLEMENTED`，不假装已暂停。

**G4（P2）— 已登记缺口，由「项目身份持久化」切片关闭**：`restore --root` 指向不同 canonical root 时无法成为「可被 daemon 打开的安装级恢复」（同上身份原因）：
CLI 完成文件/DB 恢复并输出 `daemonOpenable:false`、不写 root 映射；AC-064 的「新目录演练」由 core API 级测试覆盖。

**G5（P2，daemon 侧，已路由给 daemon 切片）**：daemon 在 admin 监听绑定前就写 `runtime.json`（`admin.port=0`），CLI 首轮因此抛未捕获异常
（WP-11 遗留项）。CLI 侧已修（轮询 + `RUNTIME_RECORD_INVALID` + operationId，含回归测试）；根治由 daemon 在绑定后再写。

**G6（P2）— 已登记缺口（本机无法执行）**：systemd 单元未在 Linux 上执行，仅静态核对；待 Linux 环境补 `systemctl --user enable --now/status/disable --now` 演练（已写入 `installation.md` §11 未验证清单）。

**G7（P3）— 收尾轮 1 已关闭**：`agentdev secret rotate <ref>` 已实现（stdin 读新值、ref 必须已存在、原子替换、输出受影响 Provider 与 `capabilities.revoked:0` 的诚实范围），含 3 例集成测试。

**G8（P3）— 收尾轮 1 已关闭（项目级覆盖仍不在内）**：全局 `~/.agentdev/config.toml` 现随备份写入 `installation/`，
恢复时仅在目标安装尚无 `config.toml` 时安装（否则 `TARGET_CONFIG_PRESENT`，绝不覆盖）；副本写入前对全部已注册值做泄漏扫描，
命中即 `SECRET_VALUE_IN_CONFIG` 拒绝。项目级 `.agentdev/config.toml` 覆盖仍不在副本内（登记为残余）。

**G9（信息）**：演练中 `evidence: 0/0`——产品路径建出的 Chief Run 在被备份时还没有产物；带证据 blob 的恢复由
`apps/cli/test/ops.integration.test.ts` 的种子数据覆盖（`artifacts.list()` 长度 1）。

## 8. 决定与待确认

1. `apps/cli` 直接声明 `@agentdev/storage`（workspace 内部包）以调用 core 的 `backupProject`；已同步 `ARCHITECTURE.md` §2。
   若要求 `apps/cli` 只依赖 `core`，可改为「core 暴露一个 `openProjectStore(dataDir)` 安装级工厂」——需改 `packages/core`（越界）。
2. `restore` 缺凭证时**退出码 0**（恢复本身成功，`status:"blocked"` + `nextSteps`），因为 `reliability.md` §8 把「缺凭证保持
   Provider 阻断」定义为预期结果而不是操作失败；如需脚本可用非零码判定，请确认改法。
3. `relocate` 对「不同 canonical root」不拒绝而是执行 + 显式告警（§7 G2）。若倾向 fail-closed（拒绝真实移动、只允许同一 canonical
   root 的别名迁移），请确认——那会使该命令在当前运行时几乎不可用。
4. AC-064 的「新目录演练」在 CLI 层是否需要强断言（目前 CLI 层是新目录 → `blocked`/`daemonOpenable:false`，core 层是新目录 →
   一致恢复）。取决于 G2/G4 的修复归属。

---

# 收尾轮 1（用户决策 a/b/c + G7/G8 + lint 收口）

- 决策 (a)：接受 `apps/cli` 对 `@agentdev/storage` 的一手依赖；`ARCHITECTURE.md` §2 的 apps/cli 行已合并为一条并写明
  「client；core、storage（仅安装级操作 secret/backup/restore/relocate 按需懒加载）」。
- 决策 (b)：`restore` 缺凭证保持**退出码 0 + `status:"blocked"`**，并在 stdout 前置 `WARNING [PROVIDER_BLOCKED] …` 显著告警行；
  `installation.md` §6 写明「脚本判 `status` 字段，不用退出码」并给示例；测试断言告警行是 stdout 首行且 `status==="blocked"`。
- 决策 (c)：`relocate` 改 **fail-closed**：目标派生不同 projectId 时以 `PROJECT_IDENTITY_MOVE_UNSUPPORTED` 拒绝，不移动、不改写；
  仅接受解析到同一 canonical root 的目标（`identityPreserved:true`）。G2/G4 作为已登记缺口写入本记录与 `installation.md` §7/§11，
  关闭切片＝「项目身份持久化」（父 Agent 后续切片）。

## 1. 本轮变更

| 文件 | 变更 |
|---|---|
| `apps/cli/src/ops.ts` | backup 追加 `installation/`（`config.toml` 副本 + `installation.json` 侧车：来源 home、sha256、字节数、`secretRefs`）；写副本前对全部已注册值做泄漏扫描，命中即 `SECRET_VALUE_IN_CONFIG`；restore 先 `verifyInstallationConfig`（侧车版本/complete/哈希/泄漏，全部在 Core 写盘之前）再 `applyInstallationConfig`（仅在目标无 `config.toml` 时写入，否则 `TARGET_CONFIG_PRESENT`），输出 `installation.{configRestored,providers,secretRefs,resolvableSecretRefs,containsSecretValues}`；告警按「最可操作优先」排序并作为前置 `WARNING [CODE]` 行打到 stdout；relocate fail-closed |
| `apps/cli/src/secret.ts` | 新增 `agentdev secret rotate <ref>`：ref 必须已存在（否则 `SECRET_NOT_FOUND`），值只从 stdin 读，原子替换（daemon 运行时经 `POST /secret`，否则直连仓库），输出 `previousUpdatedAt`/`updatedAt`/`affected.providers`/`capabilities.revoked:0` 与「不撤销已签发 capability」的诚实说明 |
| `apps/cli/src/cli.ts` | USAGE 增 `secret rotate <ref>` |
| `apps/cli/test/ops.integration.test.ts` | 14 例：新增「备份→新 home 恢复：Provider 定义在、`secretConfigured=false`、备份与新 home 均无凭证明文」「配置含凭证明文时 backup 拒绝（`SECRET_VALUE_IN_CONFIG`，且备份目录无该值）」「侧车被篡改→`STALE_ARTIFACT` 且目标零写入」「侧车 `complete:false`→`INVALID_STATE`」；relocate 4 例（跨 root 拒绝且零改动、别名成功、非仓库拒绝、短写 fail-closed）；`body()` 从第一个 `{` 解析以跳过告警行 |
| `apps/cli/test/secret.integration.test.ts` | 8 例：新增 rotate 三例（仓库路径原子替换+受影响 Provider、daemon 路径、未知 ref/空值拒绝），断言值与新旧密文都不出现在 stdout/stderr |
| `docs/architecture/ARCHITECTURE.md` | §2 apps/cli 行合并为一条 |
| `docs/operations/installation.md` | §4 rotate；§5 备份含安装级配置且绝不含量；§6 blocked 语义与 stdout 告警行、脚本判 `status`、配置恢复规则；§7 relocate fail-closed 与 G2/G4；§11 未验证与已登记缺口表 |
| `.agentdev/work/WP-12/T6-drill.mjs` | 改用 `node:http`（符合仓库 `.mjs` 只声明 Node 全局的约定，去掉 `/* global fetch */`）；JSON 从第一个 `{` 解析；新增 fresh home 的 Provider 定义/无明文/`secret rotate` 证据；relocate 段改为「拒绝跨 root + 别名成功 + daemon 重启后状态行仍在」 |
| `.agentdev/work/WP-12/T6-{drill,launchd}-output.txt` | 本轮原始输出重跑覆盖 |

## 2. 本轮真实证据

| 命令 | 结果 | 退出码 |
|---|---|---|
| `node .agentdev/work/WP-12/T6-drill.mjs` | `DRILL PASS`：真实 daemon+Chief Run；backup（含 `installation/config.toml`、`secretRefs`、无明文）；删状态与仓库；原位 restore `status:ready`、Run `running→interrupted`、doctor ok；fresh home restore `status:blocked` 且首行 `WARNING [PROVIDER_BLOCKED]`、Provider 定义在、无凭证明文；stdin 重录 + `secret rotate` 成功；relocate 跨 root 拒绝（`PROJECT_IDENTITY_MOVE_UNSUPPORTED`，零改动）、别名成功且 daemon 重启后 `works=1 run=interrupted` | **0** |
| `bash .agentdev/work/WP-12/T6-launchd-drill.sh` | 临时 label/home：bootstrap→running→`daemon.lock`→`status`→bootout→无进程/无锁/无 job/`running:false`（8 项 ok） | **0** |
| `pnpm test:integration apps/cli` | 5 文件 / 45 用例 passed（ops 14、secret 8、runtime 5、doctor 9、container 9） | **0** |
| `pnpm typecheck` | 无错误 | **0** |
| `pnpm docs:check` | `16 documents, 65 internal links, 94 acceptance cases, 9 requirements, 11 work packages` | **0** |
| `pnpm lint` | 仅 2 条 ESLint 错误，均在他方在飞文件 `packages/core/src/control-http.ts:259`、`packages/core/src/orchestrator.ts:762`（非本切片，未改）；本切片文件 scoped `eslint`（TS6 preload）与 `prettier --check` 均 exit 0 | 1（归因他方） |
| `pnpm exec prettier --check <本切片文件>` | `All matched files use Prettier code style!` | **0** |
| 本切片 scoped `eslint apps/cli/src apps/cli/test .agentdev/work/WP-12/T6-drill.mjs`（TS6 preload） | 无输出 | **0** |
| `pnpm build` | 全部工程 Done | **0** |

关键原始片段（完整见 `T6-drill-output.txt`）：

```
WARNING [PROVIDER_BLOCKED] 缺少 Provider Secret：provider:01a09f71-9d2b-…；恢复已完成（status=blocked），凭证不在备份中（reliability.md §8），Provider 保持阻断，请重新录入：agentdev secret set provider:01a09f71-9d2b-…（值从 stdin 读入）
ok   the blocked restore reports the Provider blocked
ok   the backup carries the Provider definition into the fresh installation — [{"providerId":"01a09f71-9917-…","models":["t6-drill-model"]},{"providerId":"01a09f71-9d2b-…","models":["t6-drill-model-2"],"secretRef":"provider:01a09f71-9d2b-…"}]
ok   no credential value reached the backup or the fresh installation
ok   the credential can be rotated in place — {"revoked":0,"note":"rotate 只替换凭证值：…已签发的短期 attempt capability 与冻结的 ConfigSnapshot 不会被撤销…"}
ok   relocate fails closed on a cross-root move (typed refusal) — PROJECT_IDENTITY_MOVE_UNSUPPORTED
ok   the refused relocate moved nothing and rewrote no mapping
ok   relocate accepts a target that resolves to the same canonical root
ok   the migrated state still carries its rows (works=1, Run interrupted) — works=1 run=interrupted
DRILL PASS
```

## 3. 缺口状态（本轮后）

- G1（Provider `secretRef` + Gateway 可用性 → Chief Run 不入队）：未变，路由给 T1/T2 切片。
- G2/G4（跨 root 身份迁移）：**已登记缺口**，关闭切片＝「项目身份持久化」；relocate 现 fail-closed。
- G3（§8 暂停语义）：未变，备份输出 `paused:false`。
- G5（daemon 在 bind 前写 `runtime.json`）：CLI 侧已修，根治路由给 daemon 切片。
- G6（systemd 未在 Linux 执行）：已登记，写入 `installation.md` §11。
- G7（rotate）：**已关闭**（实现 + 3 例测试 + 演练证据）。
- G8（安装级配置随备份）：**已关闭**（实现 + 测试 + 演练证据）；残余：项目级 `.agentdev/config.toml` 覆盖不在副本内。
- G9（演练 `evidence: 0/0`）：未变，带证据 blob 的恢复由 CLI 集成测试覆盖。
- 本轮新增残余：`installation.json` 侧车是 CLI 自有格式（`schemaVersion:1`），旧格式备份无该目录时给 `NO_INSTALLATION_RECORD` 警告并只恢复 Project 状态。

---

# G11 硬化（运维原语的真实 CLI 产品路径证据）

依据：`.agentdev/work/WP-12/hardening-plan.md` §2 G11、§3.1（诚实排除）、§7-Q8（主管裁决：先验证两条 T6 残留再开 G11）；
主管批准：`drill-acs.mjs` 只新增 `E2E_OPS_ACS`、不动 `RESIDUAL_GAPS`；AC-091 的 `requirement-save.cas-race` 不在本刀。

## 1. 先验证两条 T6 残留

**(a) G1（Provider 带 `secretRef` 时 Chief Run 不入队）— 已被 T2 修复，真实复验通过。**
`node .agentdev/work/WP-12/G11-verify-g1.mjs`（退出码 0，原始输出见 `G11-verify-g1-output.txt`）：临时 `AGENTDEV_HOME` + 临时 Git 项目 → 真实 CLI `agentdev start`
（真实 daemon）→ `/rpc provider.upsert` **带真实凭证**（`secretConfigured=true`）→ `config.save` 设 chief Profile →
`conversation.message.send` → Chief Run 入队。实测：

```
secretRef=provider:01a0a068-e8a9-72d4-8efc-7a1069c34881 secretConfigured=true
runId=01a0a068-e8e4-72ee-97a3-227b8bc87319 role=chief status=running
attemptId=01a0a068-ec47-7ef2-93c4-ffb128c0c34a status=running runnerId=pid:68823
loopback model calls=1
G1 VERIFIED: Chief Run reached attempt.ready and the credentialed Provider was called
```

`attempt.ready` 的直接证据是 Attempt 由 `starting → running`（`supervisor.ts:998-1011`），再加回环模型真的收到 1 次带凭证调用。
该断言同时内建在新 e2e 检查 `ops.backup-restore` 里（它创建真实数据的唯一通道就是产品路径，无播种行）。

**(b) restore 演练重跑并归档非 0/0 证据。**
`T6-drill.mjs` 新增：经产品路径 `POST /artifacts/upload`（安装 Bearer）+ 消息绑定，产生**真实用户产物**；随后 backup/损坏/restore。
`node .agentdev/work/WP-12/T6-drill.mjs` → `DRILL PASS`（退出码 0，完整输出见 `T6-drill-output.txt`）：

```
ok   a real user artifact was uploaded through the product path — 201
ok   backup carries the real evidence blob — 1
ok   restore verified the real evidence blob (non-zero) — 1/2
ok   restore marks the previously active Run interrupted — ["01a0a069-3afa-…"]
ok   restore rewrote the installation root mapping
DRILL PASS
```

（`1/2` = manifest 的 `evidence` 校验 1/1 通过、blobs 2 个全部校验通过；此前记录里的 `0/0` 已消除。）

## 2. G11 实现（真 CLI + 真文件系统）

| 文件 | 变更 |
|---|---|
| `scripts/lib/e2e-cli.mjs`（新增） | 真实 `agentdev` 子进程：生成 source-mode bootstrap（`installSourceResolver` + `apps/cli/src/cli.ts` / `apps/daemon/src/main.ts`）、`runCli()` 返回原始 stdout/stderr/退出码、`cliJson()` 跳过前置 `WARNING` 行解析 JSON |
| `scripts/lib/e2e-ops-drill.mjs`（新增） | 检查 `ops.backup-restore`：`bootCredentialedInstallation()`（真 CLI start + 真凭证 Provider + 真实附件产物 + 消息→Work→Chief Run→`attempt.ready`），备份（活 Run）→ 停止 → 删除状态目录与项目 → restore → 重启 daemon 并用其自身协议确认 Run `interrupted` → 无凭证新 home restore（blocked + 首行 `WARNING [PROVIDER_BLOCKED]` + Provider 定义随包 + 无明文）→ stdin `secret set` 后 ready → `secret rotate` → relocate 跨 root `PROJECT_IDENTITY_MOVE_UNSUPPORTED`（零改动）+ 同 canonical root 别名成功 → `doctor` → launchd 临时 label/home load/unload |
| `scripts/lib/drill-acs.mjs` | **只新增** `E2E_OPS_ACS = Object.freeze(['AC-064'])`（含注释：真实 CLI + 真实文件系统的运维原语证据）；`RESIDUAL_GAPS` 未动 |
| `scripts/e2e.mjs` | **只新增** 1 行 import + 1 行 `await runOpsDrill({ checks, meta })`（置于浏览器检查之后、`provider.fact-and-unknown` 行之前；未重排/未删任何既有检查） |

`ops.backup-restore` 的逐条断言（全部为真实子进程/真实文件）：start exit 0；`secretConfigured=true`；Chief Run `running` 且模型被调用；backup exit 0、`complete`、revision == `git rev-parse HEAD`、`secretRefs` 含该 ref、`installation.configCopied`、备份目录无凭证明文、`evidence ≥ 1`；损坏后 restore exit 0、`status:ready`、`treeMatches`、`evidenceVerified ≥ 1`/`blobsVerified ≥ 1`、doctor ok、`interruptedRunIds` 含该 Run；重启后 daemon 记录里同一 projectId/root，协议回报 `interrupted`；新 home restore `blocked` 且首行告警、Provider 定义在、无明文，`secret set` 后 `ready`，`secret rotate` 报 `rotated:true`/`capabilities.revoked:0` 且不打印值；relocate 拒绝时仓库/注册表零改动、别名成功 `identityPreserved:true`；`doctor` exit 0；launchd bootstrap/bootout 后无 runtime.json 与 `daemon.lock`。

## 3. 本轮真实退出码

| 命令 | 结果 | 退出码 |
|---|---|---|
| `node .agentdev/work/WP-12/G11-verify-g1.mjs` | `G1 VERIFIED` | **0** |
| `node .agentdev/work/WP-12/T6-drill.mjs` | `DRILL PASS`（非 0/0 证据） | **0** |
| `node scripts/e2e.mjs --no-write`（22:00，整刀完成时） | **25 checks — PASS 24 / FAIL 0 / UNVERIFIED 1**（AC-001 provider）；`27 ACs`；`ops.backup-restore [AC-064] PASS`；其余既有检查（含 T3 的）全部仍执行（原始输出 `G11-e2e-output.txt`） | **0** |
| `node /tmp/…`（等价：单跑本检查的 CheckList 驱动，lint 修复后 22:13） | `ops: …` 八个阶段全过；`ops.backup-restore [AC-064] PASS`（`G11-ops-isolated-output.txt`） | **0** |
| `node scripts/e2e.mjs --no-write`（22:15 复跑） | 在**原生浏览器检查** `browser.html-preview-and-download` 处 FAIL（期望子串 `/artifacts/download/`，实际 `http://127.0.0.1:…/artifacts/<id>/download/<token>`），该检查在 `ops.backup-restore` **之前**，故本检查未执行（`G11-e2e-rerun-browser-fail.txt`）；归因他方在飞改动 | 1（归因他方） |
| `node scripts/acceptance.mjs` | 见 §4（本轮采纳结果） | 见下 |

`ops.backup-restore` 证据串（e2e 实测，节选）：

```
credentialed Provider provider:01a0a06e-… -> Chief Run 01a0a06e-… reached attempt.ready (Attempt 01a0a06e-… running) and the loopback model received 1 credentialed call(s);
agentdev backup exit 0: revision c7974c9fbf0b, complete, secretRefs ["provider:01a0a06e-…"], installation config copied, no credential value in the backup directory;
agentdev restore exit 0 (status ready, tree 1ed076140947, evidence 1/1, doctor ok, Run 01a0a06e-… interrupted); restarted daemon reported it interrupted through its own protocol;
fresh installation restore: status blocked + first stdout line WARNING [PROVIDER_BLOCKED], Provider definitions carried (1), no credential value in the fresh home;
after stdin secret set the restore is ready; secret rotate exit 0 (capabilities.revoked=0, no value printed);
relocate --move to a different root refused with PROJECT_IDENTITY_MOVE_UNSUPPORTED and left the repository and registry untouched; relocate to an alias of the same canonical root accepted (identityPreserved);
agentdev doctor exit 0 with execution ready; launchd 单元 load/unload：bootstrap gui/501 exit 0, daemon pid 71142 published runtime.json and held daemon.lock, agentdev status running:true, bootout removed the record and the lock
```

## 4. 验收聚合采纳

采纳通路已接通：`scripts/lib/acceptance-drills.mjs` 以本次运行 nonce + 代码绑定采纳 `pnpm test:e2e` 的逐 AC 行，而本刀新增的
`ops.backup-restore` 在 e2e 报告中产出 `{ac: "AC-064", status: "PASS", checks: ["ops.backup-restore"]}`（见 `G11-e2e-output.txt`），
正是聚合器消费的行形状；AC-065/AC-094 仍由库级 curated/test-name 证据覆盖（不登记 `recorded-gap`，避免把 PASS 降级为 ACCEPTED）。

`node scripts/acceptance.mjs` 本刀实跑 **两次，均 exit 2（infrastructure problem）**，归因如下（均为他方在飞编辑，非本刀）：

| 运行 | 结果 | 归因证据 |
|---|---|---|
| #1 22:03 | exit 2 | `pnpm test:live` 报告 `codeDigest` 与当前代码树不一致（运行期间工作树被他方改写）；某个 Vitest project 未产出 JSON 报告；`apps/daemon/test/{runtime,secret,tool-bridge-permissions}.integration.test.ts` 多条失败 |
| #2 22:06 | exit 2 | `pnpm test:e2e` 在 **browser** 检查处失败（`browser.html-preview-and-download`、`browser.attachment-client-hints`，均在 `ops.backup-restore` 之前，故我的检查未执行）；integration 479 用例 6 失败，含 22:04 新出现的 `apps/daemon/test/probe-g8epoch.integration.test.ts` 与之争用默认端口；`pnpm test:live` 再次因移动的工作树拒绝绑定 |

独立复验：`apps/daemon/test/runtime.integration.test.ts` 单跑 **6/6 PASS**、`apps/daemon/test/tool-bridge-permissions.integration.test.ts` 单跑 **FAIL 1**（T3 在飞文件）、
`apps/cli/test/runtime.integration.test.ts` 单跑 **7/7 PASS**（它在 #2 中的失败是与外来 probe 文件并行争用默认端口 4317/4318 所致）。
结论：本刀的 e2e 检查自身 `exit 0`（见 §3），聚合采纳只等树稳定；在树稳定前 `pnpm test:acceptance` 的 exit 2 不能归给本刀，也不改变 AC-064 的既有 PASS。

## 5. 诚实排除与登记（不伪装）

- **AC-065（Migration）**：按 hardening-plan §3.1 #7 整条留在库级（`packages/storage/test/migrations.integration.test.ts`，6 条 curated）——「checksum 错误 → 停止启动」需要篡改真实数据库文件，属破坏性注入且污染安装，产品路径不增加判别力。**不登记 `recorded-gap`**。
- **AC-094（跨 root relocate 子句）**：按 §3.1 #20 留库级（`packages/workspace/test/cas.integration.test.ts`、`packages/core/test/requirement-save.integration.test.ts`）；同根分支的真实执行在 `apps/cli/test/ops.integration.test.ts` 与本刀的 relocate 断言里。
- **systemd 单元**：本机是 macOS，`agentdev.service` 仍未在 Linux 执行（静态核对 + `installation.md` §11 未验证清单）；已执行的是 launchd 真机 load/unload，不以它代替 systemd。
- **AC-091 的 `requirement-save.cas-race`**：主管裁决**不在本刀**（留给后续并发/竞争硬化批），本刀不声称它已提升。
- **观察（非缺口声明）**：`agentdev stop` 后立即 `agentdev start` 会复用 4318 端口，重启后的**第一次** `/rpc` 连接可能被 reset（内核 socket 竞态）；`ops.backup-restore` 对重启后的协议查询做了有界等待（30s，500ms 间隔）并在证据里保留该事实，不把它当成失败。
