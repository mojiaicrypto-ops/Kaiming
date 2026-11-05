# WP-12 T6 Compact Plan（运维与安装）

- 依据：`.agentdev/work/WP-12/plan.md` §2 DoD 7、§4 T6 行；`docs/architecture/reliability.md` §7/§8；
  `docs/architecture/ARCHITECTURE.md` §4/§5；`docs/architecture/protocol.md` §5；
  `docs/delivery/acceptance.md` AC-064/065/023–027/078。
- 范围：`apps/cli/**`、`apps/cli/templates/**`、新增安装/运维文档（登记 `docs/INDEX.md`）、
  `apps/cli/test/**`、`.agentdev/work/WP-12/T6-*.md`。不改 `packages/**`、`apps/daemon/**`、
  `apps/web/**`、`scripts/**`、`tests/**`、`docs/delivery/implementation.md`、`docs/product/*`。
- 授权：WP-12 plan 已确认；本切片沿用其范围，无新增产品行为、无新增契约命令。

## 1. 命令面（遵循 `reliability.md` §7 已固定的名字）

| 命令 | 形状 | 说明 |
|---|---|---|
| backup | `agentdev backup [<projectId>] --output <dir> [--out <dir>] [--root <path>] [--replace]` | 文档固定 `backup <projectId> --output <dir>`；`<projectId>` 可省略（安装内唯一 Project 时自动解析），`--out` 为任务书要求的别名 |
| restore | `agentdev restore <backupDir> --root <path> [--replace]` | `--root` 省略时用 manifest 的 `canonicalRoot` |
| relocate | `agentdev relocate <projectId> --root <path> [--move]` | 也接受任务书形状 `relocate <newRoot>`（<newRoot> 不是 32hex id 时按新根解析） |

失败统一 `{ok:false,error:{code,message,details?},operationId}` + 退出码 1；成功打印实际发生的事
（路径、revision/tree、撤销的 lease/grant、标 interrupted 的 Run、doctor 结果、provider 阻断与需重录的 ref）。

## 2. 实现路线

- backup/restore/relocate 都走 `@agentdev/core` 的安装级服务（`backupProject`/`restoreProject`/`relocateProject`），
  与 `secret.ts` 相同的「按需懒加载」模式；`backupProject` 需要 `ProjectStore`，因此 `apps/cli` 直接声明
  `@agentdev/storage`（workspace 内部包，非第三方新依赖）。
- restore/relocate 的 canonical root 映射：core 负责 Project 行，CLI 负责安装级 `projects.json`
  （`registerProject`/`unregisterProject`）。
- 凭证：backup 记录 `manifest.secretRefs`（读安装 `config.toml` 的 provider secretRef）；
  restore 用安装级 secret 仓库判定可用性，缺凭证 → `status:blocked` + 明确提示 `agentdev secret set <ref>`。
- 活跃 Project 判定：`runtime.json` + `/health` 真实应答的实例列表（root 或 projectId 命中即拒绝 restore/relocate）。

## 3. 真实演练（本机）

1. 临时 `AGENTDEV_HOME` + 临时 Git 仓库 → `agentdev start --root <repo>`（真实 daemon）。
2. 经 `/rpc` 的 `provider.upsert` + `config.save` 配一个指向本机「慢模型」桩的 Provider，
   `conversation.message.send` 建真实 Work + Chief Run，等到 Run `running`（真实 Runner 子进程）。
3. `agentdev backup --output <dir>`（在线、Run 运行中）→ 删掉安装状态目录与仓库 → `agentdev restore <dir> --root <repo>`。
4. `agentdev start` + `status` + `doctor` → 断言 Run `interrupted`、lease/grant 归零、SQLite 行与 Git revision 一致。
5. relocate：`agentdev stop` → `agentdev relocate <projectId> --root <newRoot>` → `agentdev start`；
   记录 daemon 重启后能否打开迁移后的状态（这是需要如实报告的风险点）。
6. launchd：临时 label + 临时 `AGENTDEV_HOME` load/unload，确认进程、锁、`status` 清理干净。

## 4. 退出条件

- `pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm test:integration apps/cli`、
  `pnpm docs:check`、`pnpm build` 全绿（另记真实退出码）。
- 上述演练有原始输出与真实退出码；安装文档步骤逐条与实际执行一致。
- 缺口（如 `reliability.md` §8「暂停新集成」无 daemon 入口、relocate 后 projectId 由 canonical root 重派生）
  在 `T6-implementation.md` 显式登记。
