# 安装与运维

版本：1.0。产品依据：[产品方案](../product/PRODUCT.md)；技术依据：[技术架构](../architecture/ARCHITECTURE.md) §5、[协议契约](../architecture/protocol.md) §5、[可靠性与部署](../architecture/reliability.md) §7/§8；验收：[AC-064/AC-065](../delivery/acceptance.md)。

本文件是**已在本机执行过**的安装/升级/备份/恢复/卸载步骤记录。每一步的命令与真实输出见 `.agentdev/work/WP-12/T6-implementation.md`；与本文件不一致的实现行为属于缺口，登记在该记录 §缺口。

## 1. 前置条件

- Node.js ≥ 24.0.0、pnpm 12.3.4、Git。默认在宿主执行，**Docker 不是前置条件**：只有项目选择用容器运行服务/数据库/测试时才需要，且不影响 Agent 的编码路径。
- 从仓库根安装与构建：

```sh
pnpm install --frozen-lockfile
pnpm build
node apps/cli/dist/cli.js doctor
```

`doctor` 输出依赖版本、目录权限与端口占用，并在可用时报告 Docker（可选容器环境）；`execution ready: yes` 时退出码 0。`pnpm doctor` 与上一条等价。

`doctor` 同时输出一行 `policy`：`permissionMode` 与**敏感文件档位** `configPolicy`（全局默认 `strict`；项目级覆盖写在 `<git-root>/.agentdev/config.toml` 的 `[policy] configPolicy`）。档位为 `test` 时该行以 `WARN` 开头并写明「本项目允许读取应用配置（application*/bootstrap*/*.properties/*.conf），凭据与密钥材料仍拒读」——非 `strict` 必须显著可见、不得静默开启（`.agentdev/work/WP-12/T3-implementation.md` 附录 A.7）。项目配置无法读取时该行给出文件名与原因，而不是退回默认值。`config.get` 的 `policy` 字段与项目设置页展示同一个值。

## 2. 安装目录

安装状态目录默认 `~/.agentdev`，可用 `AGENTDEV_HOME` 整体重定位（测试、第二个安装、演练都用它，避免碰真实目录）：

| 路径 | 内容 | 权限 |
|---|---|---|
| `installation-token` | 安装级凭证：WebUI 登录与 CLI/daemon 回环 Bearer | 0600 |
| `runtime.json` | 运行中 daemon 的 pid/epoch/admin 端口/已打开 Project 实例；停止后删除 | 0600 |
| `daemon.lock` | 单实例锁（epoch 围栏）；优雅停止后释放 | 0600 |
| `daemon.epoch` | epoch 高水位：干净停止后保留，下一次启动取 `max(锁, 高水位)+1`，防止围栏值被重放（WP-11 T-03） | 0600 |
| `projects.json` | 本安装服务的 Git root → projectId 映射（canonical root 映射） | 0600 |
| `config.toml` | 全局配置：Provider、角色 Profile、限额、策略 | 0600 |
| `secrets/` | 安装级凭证仓库；默认 `file` 后端，`keychain` 为可选后端 | 0700 |
| `logs/` | `daemon.log` 与每 Project 日志 | 0700 |
| `projects/<projectId>/` | 每 Project 的状态目录：`project.sqlite`、blobs、attempts、worktree | 0700 |

`projectId = SHA256(canonicalRoot)[0:32]`（[技术架构](../architecture/ARCHITECTURE.md) §4），因此同一 Git 仓库的不同子目录/符号路径归一为同一 Project。

## 3. 首次运行

```sh
agentdev start [--root <path>]...   # 启动 daemon 与 BFF；无 --root 时按 projects.json 打开已注册 Project
agentdev open <path>                # 注册并打开一个项目，打印 URL（必要时自动 start）
agentdev status                     # 只读：运行中吗、哪个 home、哪些实例
agentdev stop                       # 优雅停止（先停准入，再请求 Runner 安全停并回收进程）
```

daemon 默认 `127.0.0.1:4318`，BFF 默认 `127.0.0.1:4317`；均只绑回环。

登录 WebUI：读取安装凭证并粘贴到 `http://127.0.0.1:4317` 的登录框（凭证只在本机文件里，命令输出永不打印它的值）：

```sh
cat ~/.agentdev/installation-token
```

`agentdev start` 失败时退出码 1 并打印 `{"ok":false,"error":{"code":…,"message":…},"operationId":…}`；`RUNTIME_RECORD_INVALID` 表示 `runtime.json` 不是合法运行记录（例如被手改），此时 `start` 会用新 epoch 接管陈旧锁并重写记录。

## 4. 凭证录入

Provider 凭证不随备份迁移（[可靠性与部署](../architecture/reliability.md) §8），必须在每个安装里单独录入：

```sh
printf '%s' "$API_KEY" | agentdev secret set provider/<providerId>      # 首次录入或覆盖
printf '%s' "$NEW_KEY" | agentdev secret rotate provider/<providerId>  # 轮换：该 ref 必须已存在
agentdev secret list                 # 只回元数据（ref/backend/updatedAt/health），永不回值
agentdev secret delete provider/<id> # 撤销
```

`agentdev secret rotate <ref>` 用 stdin 的新值替换**已注册**的凭证（未知 ref 返回 `SECRET_NOT_FOUND`，首次录入请用 `set`）：
替换是一次原子写入（tmp+rename 或一次 admin `POST /secret`），输出 `previousUpdatedAt`/`updatedAt`、受影响的 Provider（`affected.providers`）与 `capabilities.revoked:0`。
范围要说清：rotate 只改变**下一次 gateway 调用**解析到的值（daemon 运行时立即生效，否则下次 `start` 装载）；它**不会**撤销已经签发的短期
attempt capability，也不会让已冻结的 ConfigSnapshot 改指其它 ref。需要立即阻断某个 Provider，请禁用它或 `agentdev secret delete <ref>`。

- 值只从 stdin 读取，**CLI 自身从不把值放进 argv**，因此不出现在 CLI 进程的 `ps`、shell 历史或进程标题里。
- 登录 WebUI 后也可在设置页填写 API Key；浏览器只提交一次，服务端回写仓库，页面不回显。
- 后端默认 `file`：`~/.agentdev/secrets/file/` 下 0600 的 AES-256-GCM 记录 + 0600 主密钥，跨平台且可单测。
- Provider 的 `secretRef` 命名约定是 `provider:<providerId>`；`backup` 只记录这些标识，不记录值。`secretRef` 由「设置页保存 Provider（连同 API Key）」或 `provider.upsert` 服务端生成：只跑 `agentdev secret set <ref>` 不会把该 ref 接到某个 Provider 上，Provider 侧仍显示未配置。

### macOS Keychain（显式选用，已在真机验证）

```sh
AGENTDEV_SECRET_BACKEND=keychain agentdev start              # daemon 的后端
printf '%s' "$API_KEY" | AGENTDEV_SECRET_BACKEND=keychain agentdev secret set provider/<id>
AGENTDEV_SECRET_BACKEND=keychain agentdev secret list
```

后端选择只由 `AGENTDEV_SECRET_BACKEND` 决定，未设置时**所有平台（含 macOS）都是 `file`**；`keychain` 仅在显式设置时使用。daemon 与 CLI 必须用同一个值，否则 CLI 写进 Keychain、daemon 却按文件后端装载。

条目位置与人工查看/删除（macOS 26.5.1 实测）：

- 值存在**登录钥匙串**（`~/Library/Keychains/login.keychain-db`）的 generic password 条目里：`service = agentdev-secret`，`account = <ref>`。`~/.agentdev/secrets/keychain/index.json`（0600）只是元数据索引（ref/audience/updatedAt），不含值。
- 人工查看与删除（值为可打印 ASCII 时 `-w` 原样输出；含非 ASCII 或控制字符时 `security` 以十六进制输出，仓库读取时会还原）：

```sh
security find-generic-password -a 'provider/<id>' -s agentdev-secret -w
security delete-generic-password -a 'provider/<id>' -s agentdev-secret   # 等价于 agentdev secret delete
```

- **argv 暴露（平台限制，已实测复现，不隐藏）**：`security add-generic-password -w <value>` 把值放进子进程 argv，在该子进程存活的极短窗口里 `ps -axww` 可见（实测捕捉到 `security add-generic-password -a <ref> -s agentdev-secret -w <value> -U`）。CLI 自身进程的 argv 不含值（值只从 stdin 读）。这正是不把 `keychain` 设为默认后端的原因，且在不引入原生依赖的前提下无法消除。
- **跨安装共享（已登记缺口）**：Keychain 条目按**用户**而非 `AGENTDEV_HOME` 隔离，所以同一用户的两个安装若使用相同 ref 会读写同一条目（`file` 后端按 home 隔离）。需要安装级隔离时给 ref 加安装专属前缀，或改用 `file` 后端。
- 装载逐条容错：索引行存在而条目缺失或读不到时，该 ref 记为 `health: missing`/`unreadable` 并进入 `problems`，daemon 仍启动；`agentdev secret list` 输出 `health`/`issue` 与 `problems`。
- 真机 opt-in 集成测试（默认跳过，不写操作者钥匙串）：`AGENTDEV_KEYCHAIN_IT=1 pnpm vitest run --project integration packages/core/test/secret-repository.keychain.integration.test.ts`。

## 5. 备份

```sh
agentdev stop                                   # 推荐：让备份处于静止的一致检查点
agentdev backup --output <dir>                  # 单 Project 安装可省略 projectId
agentdev backup <projectId> --output <dir>      # 多 Project 时按文档形状指定
agentdev backup --out <dir> --replace           # 目标非空时必须显式替换
```

备份内容分两部分：

1. **Project 状态**（Core 的 `backup.json`）：SQLite 在线一致快照（`VACUUM INTO` + `integrity_check`）、blobs/证据、知识树、全部 AgentDev refs 的 Git bundle；清单记录 `projectId`、`canonicalRoot`、`deliveryBranch`、`revision`/`tree`、`knowledge.treeHash`、`secretRefs`。
2. **安装级配置**（CLI 追加的 `installation/`）：`installation/config.toml` 是 `~/.agentdev/config.toml` 的副本（Provider 与角色 Profile **定义**、限额、策略），`installation/installation.json` 记录来源 home、哈希、字节数与 `secretRefs`。

**凭证值绝不进入备份**：写副本前会把配置文件与安装凭证仓库里每个可解析的值做泄漏扫描，命中即用 `SECRET_VALUE_IN_CONFIG` 拒绝本次备份；`installation-token`、`secrets/`、主密钥都不会被复制。恢复后凭证必须用 `agentdev secret set <ref>` 重新录入，缺失时 Provider 保持阻断。

拒绝：目标目录非空且未给 `--replace`（`INVALID_STATE`）；证据 blob 缺失/损坏（`ARTIFACT_MISSING`）；Project 未注册到本安装（`NOT_FOUND`）；配置含凭证明文（`SECRET_VALUE_IN_CONFIG`）。

当前 daemon 没有「暂停 Project / 暂停新集成」的入口，因此成功输出带 `paused:false` 与 `PAUSE_NOT_IMPLEMENTED` 警告：快照取自 SQLite 在线一致事务，知识树取自当时工作树。daemon 正在运行时备份会额外给出 `PROJECT_OPEN_WHILE_BACKUP`；安装没有 `config.toml` 时给出 `NO_INSTALLATION_CONFIG`。

## 6. 恢复

```sh
agentdev restore <backupDir> --root <path> [--replace]
```

按文档顺序执行并逐项拒绝：

1. 目标 root 上有**活动 Project**（`runtime.json` 中实例 + `/health` 真实应答）→ `INVALID_STATE`，先 `agentdev stop`。陈旧的注册表条目不算活动 Project。
2. 清单缺失/非法/不完整 → `NOT_FOUND` / `VALIDATION_ERROR` / `INVALID_STATE`；清单哈希与文件不一致 → `STALE_ARTIFACT`。
3. 目标目录非空且未给 `--replace` → `INVALID_STATE`（提示已备份后用 `--replace`）。
4. 校验清单 → 恢复 Git 与文件 → 恢复 SQLite → 更新 Project 行与安装级 root 映射 → 撤销旧租约/capability → 把原活动 Run 标 `interrupted` → 运行 doctor 并打印结果。

成功后输出 `status`（`ready` / `blocked`）、`revision`、`consistency`、`recovery`（`interruptedRunIds`/`revokedLeases`/`revokedGrants`）、`doctor.checks`、`registryUpdated`，以及安装级配置的处理结果 `installation`（`configRestored`、`providers`、`secretRefs`、`resolvableSecretRefs`、`containsSecretValues`）。

**输出约定**：`backup`/`restore` 会把需要人处理的告警作为**前置的 `WARNING [CODE] …` 行**打到 stdout，JSON 从第一个 `{` 开始。脚本请解析 JSON 里的字段判断结果，**不要用退出码**：例如恢复完成但缺凭证时退出码仍是 0、`status` 是 `"blocked"`。示例：

```sh
out=$(agentdev restore "$BACKUP" --root "$ROOT")
status=$(printf '%s' "$out" | sed -n '/^{/,$p' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).status))')
[ "$status" = ready ] || echo "provider blocked: re-enter the credential (agentdev secret set <ref>)"
```

**缺凭证**（`status:"blocked"`，退出码 0）：备份不含 Secret。恢复到的安装无法解析清单里的 `secretRefs` 时 `doctor.executionReady=false`，stdout 首行是 `WARNING [PROVIDER_BLOCKED]`，`nextSteps` 给出 `agentdev secret set <ref>`（值从 stdin 读入）；录入后再次恢复（`--replace`）即 `ready`。

**安装级配置**：备份里的 `installation/config.toml` 只在目标安装**尚无** `config.toml` 时写入（`configRestored:true`）；目标已有配置时保留目标配置并给 `TARGET_CONFIG_PRESENT` 警告——绝不静默覆盖运维后来改过的 Provider。旧格式（无 `installation/`）备份给 `NO_INSTALLATION_RECORD` 警告，只恢复 Project 状态。

**`--root` 与清单的 canonical root 不同**时输出 `daemonOpenable:false` 并给 `ROOT_DIFFERS_FROM_BACKUP` 警告：projectId 由 canonical root 派生，daemon 在该 root 会派生新的 projectId 与状态目录，因此 CLI 不写安装级 root 映射。原地恢复（同一 canonical root）才是可被 daemon 打开的安装级恢复；跨 root 的安装级迁移由「项目身份持久化」切片关闭（见 §11）。

## 7. 迁移到新 root

```sh
agentdev stop
agentdev relocate <projectId> --root <newRoot> [--move]   # 也接受 relocate <newRoot>（单 Project）
agentdev start
```

`relocate` **fail-closed**：`projectId` 由 canonical root 派生（[技术架构](../architecture/ARCHITECTURE.md) §4），因此目标会派生不同 projectId 时直接拒绝，不移动任何目录、不改写任何映射：

```
$ agentdev relocate <projectId> --root /new/path --move
{"ok":false,"error":{"code":"PROJECT_IDENTITY_MOVE_UNSUPPORTED","message":"拒绝跨 root 迁移：projectId 由 canonical root 派生…当前 runtime 尚不支持迁移 Project 身份…"}}
```

只有解析到**同一 canonical root** 的目标才被接受（例如指向同一仓库的别名/符号路径，输出 `identityPreserved:true`、`daemonOpenable:true`）：改写 Project 行的 root/gitRoot、回收租约、park 活动 Run、重跑 doctor，并更新 `projects.json`。daemon 正在打开该项目时先拒绝（请 `agentdev stop`）。

**已登记缺口（属运行时，由「项目身份持久化」切片关闭）**：daemon 的 projectId（以及状态目录 `~/.agentdev/projects/<projectId>`）由 canonical root 派生，所以当前 runtime 无法把已有身份迁移到另一个 root —— 迁移后的状态会成为孤儿（实测 `works=0` vs `works=1`）。在该切片落地前不要移动仓库路径；`relocate` 只用于同一 canonical root 的路径别名与映射校验。

## 8. 升级

```sh
agentdev stop
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
agentdev start
```

打开时会运行 SQLite 迁移；迁移前在该 Project 状态目录旁生成一致性备份（`data.md` §5，AC-065），checksum 错误则迁移抛错、daemon 不启动 Agent。升级不改变 `~/.agentdev` 布局；`runtime.json` 版本不匹配会以 `PROTOCOL_MISMATCH`/`RUNTIME_RECORD_INVALID` 明确失败而不是猜测。

## 9. 作为用户服务运行

### macOS（launchd）

```sh
mkdir -p ~/.agentdev/logs                       # launchd 在启动前打开 StandardOutPath，目录必须已存在
sed -e "s|__NODE__|$(command -v node)|g" \
    -e "s|__AGENTDEV_REPO__|$PWD|g" \
    -e "s|__AGENTDEV_HOME__|$HOME/.agentdev|g" \
    apps/cli/templates/com.agentdev.daemon.plist > ~/Library/LaunchAgents/com.agentdev.daemon.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.agentdev.daemon.plist
launchctl print gui/$(id -u)/com.agentdev.daemon | head -20
agentdev status
launchctl bootout gui/$(id -u)/com.agentdev.daemon   # 卸载；之后 agentdev status 应为 running:false
```

`KeepAlive` 让 daemon 崩溃后由 launchd 重启，恢复扫描针对它留下的数据库执行。`bootout` 后不应残留 daemon 进程或 `daemon.lock`。

### Linux（systemd 用户服务）

```sh
mkdir -p ~/.config/systemd/user
sed -e "s|__NODE__|$(command -v node)|g" \
    -e "s|__AGENTDEV_REPO__|$PWD|g" \
    -e "s|__AGENTDEV_HOME__|$HOME/.agentdev|g" \
    apps/cli/templates/agentdev.service > ~/.config/systemd/user/agentdev.service
systemctl --user daemon-reload
systemctl --user enable --now agentdev.service
systemctl --user status agentdev.service
systemctl --user disable --now agentdev.service
```

`ExecStart` 的可执行文件必须是绝对路径；`Environment=AGENTDEV_HOME=` 与 `--home` 一致，daemon 只监听回环。systemd 单元在本机（macOS）**未执行**，只做静态核对（与 launchd 同一 daemon 入口与同一参数），登记在 T6 记录的缺口里。

## 10. 卸载

```sh
agentdev stop
launchctl bootout gui/$(id -u)/com.agentdev.daemon        # 或 systemctl --user disable --now agentdev.service
rm -f ~/Library/LaunchAgents/com.agentdev.daemon.plist     # 或 ~/.config/systemd/user/agentdev.service
rm -rf ~/.agentdev                                         # 安装状态与凭证；删除前请先备份
rm -rf <checkout>                                          # 代码与构建产物
```

`rm -rf ~/.agentdev` 会同时删除凭证仓库与所有 Project 状态，且不可恢复；需要保留交付历史时先 `agentdev backup --output <dir>` 并把备份目录移出安装目录。

## 11. 未验证与已登记缺口

| 项 | 状态 | 说明 |
|---|---|---|
| systemd 用户服务 | **未在真机执行** | 本机是 macOS（无 systemd）；`agentdev.service` 只做静态核对（同 daemon 入口/参数、`__NODE__` 必须绝对路径）。需在 Linux 环境执行 `systemctl --user enable --now/status/disable --now` 后补记 |
| daemon 写 `runtime.json` 的中间态 | **daemon 侧待修** | daemon 在 admin 监听绑定前就写记录（`admin.port=0`）；CLI 已容忍该中间态并轮询（`RUNTIME_RECORD_INVALID`+operationId 兜底），根治需 daemon 绑定后再写（路由给 daemon 切片） |
| 跨 root 迁移身份（原 G2/G4） | **已登记缺口** | 见 §7；由「项目身份持久化」切片关闭 |
| backup 的「暂停 Project」语义 | **已登记缺口** | [可靠性与部署](../architecture/reliability.md) §8 的暂停在当前 daemon 无入口；备份用 SQLite 在线一致快照 + 工作树知识树，输出 `paused:false` |
| 带 `secretRef` 的 Provider 可用性 | **daemon/core 侧待修** | Gateway 可用性检查在无 Grant 上下文中解析 Provider 凭证会失败，导致 `conversation.message.send` 不入队 Chief Run（路由给 T1/T2 切片） |
| Keychain 条目跨安装共享 | **已登记缺口** | 条目按用户（登录钥匙串）而非 `AGENTDEV_HOME` 隔离；同用户两个安装用相同 ref 会读写同一条目。需安装级隔离时给 ref 加安装前缀或改用 `file` 后端（见 §4） |
| `security -w <value>` 的 argv 暴露 | **平台限制（已实测）** | 值在 `security` 子进程 argv 中短暂可见（`ps` 可捕捉）；CLI 自身 argv 不含值。故 `keychain` 严格 opt-in、默认 `file`（见 §4） |

## 12. 演练记录

真实演练（临时 `AGENTDEV_HOME` + 临时 Git 项目，含真实 daemon、真实 Run、备份→损坏→恢复→doctor、凭证缺失阻断、relocate、launchd 加载/卸载）见 `.agentdev/work/WP-12/T6-implementation.md`；可复跑脚本：`.agentdev/work/WP-12/T6-drill.mjs` 与 `.agentdev/work/WP-12/T6-launchd-drill.sh`。

macOS Keychain 后端的真机演练（真 `/usr/bin/security`、随机 item 前缀、真 daemon + 回环桩 Provider、含值掩码与清理证据）见 `.agentdev/work/WP-12/keychain-verification.md`；可复跑脚本：`.agentdev/work/WP-12/wp12-keychain-drill.mjs`，原始输出 `.agentdev/work/WP-12/keychain-drill-output.txt`。
