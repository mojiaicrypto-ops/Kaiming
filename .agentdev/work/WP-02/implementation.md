# WP-02 实现记录

对应 `.agentdev/work/WP-02/plan.md`（planVersion 1）。按任务追加，证据只写已运行的命令与结果。

## T1 配置与继承（AC-043, AC-044）—— 完成

- `packages/core/src/toml.ts`：`~/.agentdev/config.toml` 所需的最小 TOML 子集读写（表头、`[[数组表]]`、点号键、基本字符串与 `\n \t \r \" \\` 转义、整数/浮点/布尔、标量内联数组）；超出子集的语法抛 `TomlError(message, line)`，不做静默兜底。
- `packages/core/src/snapshots.ts`：`SnapshotWriter.freeze(type, payload)` 以 `sha256(canonicalJson(payload))` 为哈希写入 `snapshot` 行（同 type 同 payload 幂等），`read(hash)`、`byType(type)` 读回并用 `snapshotSchema` 校验；见 DC-28。
- `packages/core/src/config.ts`：`ConfigStore.open({globalDir, projectRoot, snapshots})`；全局与 Project 两个 scope 的文档读写（版本号 +1、原子写入、0600 权限）、`update(scope, patch)`（Schema 校验、同 scope 字段级合并）、`upsertProvider`、`provider`、`effectiveLimits`（固定常量不可覆盖）、`resolve(role, runParams)`（Run→Project→全局角色→全局默认，逐字段记录来源）、`freeze(role, runParams)`、`readFrozen(snapshotId)`。
- 能力校验：provider 存在且 enabled、model 属于该 provider、`reasoning ∈ model.reasoningLevels`、`effectiveContextLimit = min(profile.contextLimit, model.contextWindow − maxOutputTokens − 4096) ≥ 4096`；任一不满足返回 `{ok:false, code}`（`PROVIDER_UNAVAILABLE`/`CONFIG_INVALID`），不降级、不换模型。
- `packages/contracts/src/entities/run.ts`：新增 `snapshotRefSchema = hashSchema` 用于 Run 的三个快照引用；`structures.ts` 新增 `providerConfigSchema`、`policyConfigSchema`、`configDocumentSchema`，`configPatchSchema.roleOverrides` 改为 `partialRecord`。见 DC-27、DC-29。
- 测试 `packages/core/test/config.test.ts`（8 条）：TOML 往返与拒绝非法语法、四层继承与逐字段来源、Run 参数覆盖、能力校验失败（缺模型/不支持的 reasoning/未知 provider/禁用 provider）、冻结快照不被后续配置改动影响且存储禁止 UPDATE、patch 边界与固定常量、非法文件拒绝启动、重开进程版本与内容保持。

## T2 模型网关（AC-043, AC-044）—— 完成

- `packages/core/src/model-gateway.ts`：`availability(role, runParams)`（准入判定，失败即 Work `blocked(provider)`）、`frozenProfileOf(run)`（读 Run 的 `config` 快照，缺失抛 `STALE_ARTIFACT`）、`complete(run, messages)`（模型/reasoning/上下文上限只来自冻结快照，签名上不提供任何选择模型的入口）、`testConnection(providerId, modelId)`（最小请求 + 延迟）、`tokensOf`。
- `GatewayTransport`、`SecretResolver` 为注入缝；真实 Provider 调用与 Secret 存储属于 WP-07/WP-10（DC-31）。
- 测试 `packages/core/test/model-gateway.test.ts`（6 条）：按冻结档运行并携带 secret、配置变更后活动 Run 仍用旧模型而新冻结生效、无可用模型时准入失败且不回落、快照缺失/secret 缺失分别报 `STALE_ARTIFACT`/`CONFIG_INVALID` 且不发请求、provider 失败原样上报（retryable）、连接测试成功与未配置模型报错。

### 本任务验证命令

- `pnpm typecheck`：通过（无输出）。
- `pnpm lint`：通过（`All matched files use Prettier code style!`）。
- `pnpm test:unit`：187 passed（新增 14 条）。
- `pnpm test:integration`：10 files / 124 passed（未回退）。

## T3–T8 待办

- T3 Assessment、T4 dispatch/Run、T5 join、T6 `request_dispatch`、T7 stage 契约、T8 重启窄范围：见 `plan.md`，尚未开始。
