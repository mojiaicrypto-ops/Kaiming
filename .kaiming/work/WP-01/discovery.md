# WP-01 Discovery 记录

规则依据：`docs/rules/workflow.md` §6「Discovery：defect、technical_correction、product_change、followup、blocking_risk。保存证据、影响、建议、实际路由、关联Finding/Decision。缺陷和范围内技术修正自动返工；产品变化给出本次处理/以后处理/不采纳。」

编号接续 WP-00（DC-01…DC-17）。本文件记录 WP-01 期间的缺陷、范围内技术修正与移交后续工作包的跟进项；所有「实际路由」均为已执行或已明确移交的动作。

## DC-18 blocking_risk（文档内部不一致）：`project.create` 要求 `name`，`project` 表没有 `name` 字段

- 证据：`protocol.md` §3 的 `project.create` 入参与 `ProjectSummary` 暴露 `name`；`data.md` §2 的 `project` 行字段为 `root/codeRoot/documentRoot/deliveryBranch/trust/state`，无 `name`；`packages/contracts/src/entities/project.ts` 的 `projectSummarySchema` 需要 `name` 才能成立。
- 影响：WP-09 接线 `project.create` 时无可写字段，届时只能临时决定是加列还是改名，属产品/协议语义选择，不能由实现者自行选择。
- 实际路由：移交 **WP-09**（协议与 BFF 接线），需用户/产品确认后才落库；本包不改 `docs/**`、不加列。首次独立 Review 记为 RE-11。
- 关联：RE-11；AC-023（项目打开/切换）。

## DC-19 blocking_risk（契约未表达 Gate 前置）：`planSchema` 未约束非 L1 的 `productRef` 与 L3 `rollback`

- 证据：`structures.ts` 的 `planSchema` 中 `productRef` 可选、`rollback` 允许为空；`workflow.md` §4 要求非 L1 Plan 必须有 `productRef`，L3 必须有回退。
- 影响：契约层无法拒绝缺 Product 的 L2/L3 Plan；若不在 Gate 层补，AC 相关等级门禁可被绕过。
- 实际路由：移交 **WP-02（Work/Run 状态与 Gate）与 WP-06（Plan/交付门禁）**，在 Gate 校验中实现（跨字段条件依赖 `plan.level`，属 Gate 语义而非行级 Schema）。首次独立 Review 记为 RE-12。
- 关联：RE-12；`docs/rules/workflow.md` §4。

## DC-20 technical_correction：迁移 0001 在首个发布前就地修正，校验和随之冻结

- 证据：为落实 RE-03（`assessment` 不可变），`packages/storage/src/schema.ts` 的 `UPDATE_BLOCKED_TABLES` 变化使迁移 0001 的 SQL 变化，`migrationChecksum(MIGRATIONS[0])` 由 `6224f5a3…`（tree `196f56ff`）变为 `8de04150…`；复评在临时副本上复现：旧树创建的库在 HEAD 打开报 `MIGRATION_CHECKSUM_MISMATCH`。
- 影响：仅影响 WP-01 期间由早期提交创建的本地库；**没有任何已发布或用户持有的数据库**，因此不需要追加补偿迁移。若不自证，后续 Review/Test 会反复把该差异判为破坏升级路径。
- 建议/实际路由：确认为范围内技术修正并**冻结**——`packages/storage/test/migrations.integration.test.ts` 新增用例把 0001 的校验和钉为常量（`8de041504378a4caf4292a38f6d542100c7b97fe90a4e560d43a623fc98e2dff`），注释说明此后任何 schema 变化必须**追加新迁移**，就地编辑 0001 即测试失败。WP-01 期间创建的本地库按一次性开发数据处理（删除重建）。
- 关联：复评 NF-02；AC-065；`data.md` §5。

## DC-21 technical_correction：迁移前备份必须按来源版本命名

- 证据：复评 NF-01 实测：默认目标固定为 `<stateDir>/backups/pre-migration.sqlite`，而 `VACUUM INTO` 拒绝覆盖已存在文件，第二次待迁移（0002）在 `runMigrations` 的 try 之外抛裸 `SqliteError: output file already exists`，迁移不执行，AC-065 升级路径不可用。
- 影响：首次安装后任何真实升级都会失败——比「不备份」更糟（拒绝启动）。
- 建议/实际路由：`RunMigrationsOptions` 增加 `backupDir`，备份文件名为 `pre-migration-v<来源版本>.sqlite`；同版本重试复用已有副本（该副本仍是升级前同版本状态）。`ProjectStore.open` 传 `<stateDir>/backups`。新增用例：连续两次升级各留一份且不冲突、重跑不再备份。
- 关联：复评 NF-01；AC-065；RE-04；`data.md` §5。

## DC-22 defect：RE-14 的负例用例空泛（复核方法登记）

- 证据：复评报告 NF-03——原用例 `DROP TABLE event` 后 `poll` 在进入 `try` 之前先调用 `watermark()` 即抛错，`catch` 内的错误分类分支从未执行；复评回退 RE-14 修复后该用例仍 17/17 通过。
- 影响：即使错误分类退化为「一律 RESYNC_REQUIRED」，测试也不会失败，掩盖真实存储故障被伪装为「需重新快照」。
- 建议/实际路由：改为注入可控的 `readAfter`（Proxy 保留其它方法），分别注入普通错误与 `ResyncRequiredError`，断言前者原样抛出、后者转换为 `RESYNC_REQUIRED`。开发者已按复评结论自证：回退修复后该用例失败、恢复后通过。
- 关联：复评 NF-03；RE-14。

## DC-23 followup：需求 Git 往返（跨服务器）移交 WP-04/WP-08

- 证据：`packages/core/src/requirements.ts` 只实现本机 SQLite 投影的幂等/冲突/不静默覆盖；`metadataHashOf` 已支持传入 `requirement.json` 原始字节（`rawMetadata`），但调用方（Git 读取路径）尚不存在。
- 影响：AC-092 的「拉取已更新 Git 但投影未刷新时保存必须拒绝覆盖」「用户修复 Git 后显式导入解除冲突」以及 `REQUIREMENT_PATH_IGNORED` / 旧格式 `LEGACY_REQUIREMENT_FORMAT` 未实现。
- 实际路由：移交 **WP-04**（需求目录读写、ignore 检查、提交）与 **WP-08**（结算/最终知识提交）；**WP-10** 跨服务器复验。本包不改产品语义。
- 关联：AC-092；Test 报告 §8.2。

## DC-24 followup：事件/认证的真实传输层移交 WP-09

- 证据：`EventHub` 为进程内订阅 + SQLite 事件日志，`ConnectionQueue` 为进程内输出队列；`AuthService` 只做请求判定；仓库当前只有 `apps/cli` 与 `apps/runner`，无 HTTP/WS 服务端。
- 影响：AC-078 的「HTTP/WS 写请求拒绝」与「后台 Work 保留」、AC-059 的真实慢连接/帧发送、AC-023 的运行时切换均无端到端证据。
- 实际路由：移交 **WP-09**（协议与 BFF 接线、`connection.hello`/`project.open` 等全局方法注册）；「后台 Work 保留」另需 WP-02/03 的 Work 执行，最终 **WP-10** 复验。
- 关联：AC-023/059/078；Test 报告 §8.1/8.3/8.4。

## DC-25 followup：真实 Provider 纵向运行与三条命令

- 证据：`pnpm test:e2e`、`pnpm test:acceptance`、`pnpm test:live` 按契约以 `NOT_IMPLEMENTED` 退出 1（归属 WP-09/WP-10/WP-10）。
- 影响：无真实模型参与的端到端与验收路径尚不可执行。
- 实际路由：WP-09 提供端到端骨架，WP-10 在用户提供真实 Provider（baseUrl + 模型 ID + Secret 注入）后复验。
- 关联：Test 报告 §8.5；`.agentdev/work/WP-00/discovery.md` DC-14。

## DC-26 followup：备份护栏的 4 项 P3 残余（复评三 NF3-01…NF3-04）

- 证据（`.agentdev/work/WP-01/review.md` §4，均以 `/tmp` 探针实测，非推测）：
  1. **NF3-01**：显式传入 `backupPath`（无自定义 hook）时，复用判定只看"可读完整"，不校验副本的来源版本；探针 F 显示 v1→v2 的备份与 v0 副本逐字节相同（`ledger=[]`）。生产默认路径为版本化文件名（`pre-migration-v<version>.sqlite`），不受影响，且仓库内无调用方以该组合传参。
  2. **NF3-02**：1 字节残留文件被 SQLite 视为合法空库且 `integrity_check='ok'`，`size === 0` 只挡住 0 字节；新的写入路径先写 `.partial` 再 rename，目标文件不会由本进程产生该状态，故仅影响历史遗留文件。
  3. **NF3-03**：复用分支未清理已存在的 `<target>.partial`，成功路径可能留下无害垃圾文件（从不被读取，下次替换时删除）。
  4. **NF3-04**：`:memory:` 数据库叠加 `backupPath` 时，`backupDatabase` 按设计跳过，随后 `renameSync` 抛裸 `ENOENT`（非 `StorageError`）；仓库内无此组合调用。
- 影响：四项均不阻断 WP-01 验收（复评三判定 PASS，5 项 P3；本组为其中 4 项），生产默认路径不受影响；属健壮性/诊断一致性改进。
- 建议/实际路由：随 **WP-09**（daemon 备份/迁移接线）一并收紧——为显式 `backupPath` 增加来源版本标记或改为每次刷新、复用判定追加 `schema_migrations` 表存在性检查、复用分支清理 `.partial`、内存库路径显式返回"不备份"而非抛裸错。已在 `settlement.md` §6 登记为残余项。
- 关联：复评三 NF3-01…NF3-04；AC-065；DC-20/DC-21。
