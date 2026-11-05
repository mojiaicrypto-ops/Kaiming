# WP-01 结算（Settlement）

- 工作包：WP-01 数据、状态与协议核心（`docs/delivery/implementation.md` §2）
- 等级：L2；Plan `.agentdev/work/WP-01/plan.md`（planVersion 1，用户指令「继续」授权按依赖顺序实现）
- 关联验收：AC-023、AC-024、AC-055、AC-056、AC-059、AC-060、AC-065、AC-078、AC-092
- 基线提交：`79d5895`（WP-00 结算）
- 验证代码树：commit `e02fb8e6c4972e41f5aba9695d765a9f25723eec`，tree `c201f4276c1507fd41f0dd860df91d915c86ac6c`
- 证据提交：`6546320`（独立 Review/Test 证据）；本结算提交只新增/更新 `.agentdev/work/WP-01/` 与 `docs/INDEX.md`，**代码树未变**
- 证据目录：`.agentdev/work/WP-01/`（plan / implementation / discovery / review / test-report / settlement）

## 1. 实际 Diff

`79d5895..e02fb8e`：62 个路径、+11517/−1（1 行删除为 `package.json` 依赖列表改写），分五个提交：

| 提交 | 内容 |
|---|---|
| `dab17f9` | 实体契约（`data.md` §2 全 28 张表 + §3 结构）、领域状态机/路由/权限/需求判定、SQLite 迁移底座 |
| `722b60d` | 仓储版本 CAS、命令幂等账本、事件日志、outbox、租约、内容寻址 blob |
| `fc8260f` | `ProjectMailbox` 串行短命令与命令分发器 |
| `c3a581f` | 事件订阅/背压（EventHub）、连接认证与 Project 身份、需求投影 |
| `8e96ee2`/`9c634f0`/`e02fb8e` | 独立 Review/复评发现的两项 P1、NF-01 P1 与相关 P2/P3 修复 |

新增包：`packages/contracts/src/entities/*`、`packages/domain/src/*`、`packages/storage/src/*`、`packages/core/src/*` 及各自测试与构建配置。`apps/*` 仅在 WP-00 基础上无人为改动；`docs/` 仅本结算更新 `docs/INDEX.md` 的实现状态（技术事实/索引更新，无产品语义或规则改动）。

## 2. 工程命令结果（独立 Test，tree `c201f42`）

| 命令 | 退出 | 结果 |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | 锁文件一致 |
| `pnpm typecheck` | 0 | strict 无错误 |
| `pnpm lint` | 0 | 类型感知 ESLint + Prettier 通过 |
| `pnpm test:unit` | 0 | 13 文件 / 173 用例 |
| `pnpm test:integration` | 0 | 10 文件 / 124 用例（含真实 Docker 容器 9 例） |
| `pnpm docs:check` | 0 | 15 documents / 55 links / 94 AC / 9 REQ / 11 WP |
| `pnpm build` | 0 | contracts/domain/storage/core/pi-runtime/runner/cli |
| `pnpm test:e2e` | 1 | `NOT_IMPLEMENTED … lands with WP-09`（按契约失败） |
| `pnpm test:acceptance` | 1 | `NOT_IMPLEMENTED … lands with WP-10` |
| `pnpm test:live` | 1 | `NOT_IMPLEMENTED … lands with WP-10` |

必需失败测试（`plan.md` §5）均由真实用例覆盖并经独立复跑：丢应答重试（dispatcher/cli 账本）、冲突键（同键异载荷）、慢连接（EventHub 软限合并 + 硬限关闭且事件不丢）、迁移失败（回滚 + checksum 不一致 + 版本超前）、长操作不阻塞（mailbox 在长 effect 在飞时 <1s 应答）。

## 3. 独立验证

| 角色 | 冻结点 | 结论 | 位置 |
|---|---|---|---|
| Review | `c3a581f`/`196f56ff` | **FAIL**：2×P1（RE-01 需求记录路径、RE-02 导入非单事务）+ 12×P2/P3 | `review.md` §1 |
| 复评 | `8e96ee2`/`f1589696` | **FAIL**：RE-01/RE-02 已修复；新增 NF-01(P1)、NF-02…NF-05 | `review.md` §2 |
| 复评二 | `9c634f0`/`981746c` | **FAIL**：NF-01/NF-02/NF-03 已修复；新增 NF2-01(P2)、NF2-02/03(P3) | `review.md` §3 |
| 复评三 | `e02fb8e`/`c201f42` | **PASS**：RE-01…RE-14、NF-01…NF-05、NF2-01…NF2-03 逐项 verified（RE-11/RE-12 按记录移交后续包）；新增 5×P3（NF3-01…NF3-05），均不阻断验收 | `review.md` §4 |
| Test | `e02fb8e`/`c201f42` | **PASS**：十条命令、五项必需失败测试、三轮修复核对、3 个仓库外自建探针全部通过；未覆盖项均标注归属 | `test-report.md` |

变异自证（Reviewer 在仓库外副本执行，仓库未改动）：回退 RE-01/RE-02/RE-14/NF2-01/NF2-03 修复后对应用例分别失败，恢复后通过——证明断言非空泛。开发者侧同样自证 NF2-01/NF2-03。

## 4. 验收对应

- **AC-023/AC-024**：真实 `git init` 仓库与真实符号链接：两个根得不同 projectId 且各自独立 SQLite；子目录/尾斜杠/符号链接归一到同一 id；`projectId = SHA256(canonicalRoot)[0:32]`；嵌套仓库被发现并从父项目路径排除且必须单独打开（深度可限、可跳过）。Reviewer 与 Tester 各自独立探针复现。
- **AC-055**：同键同载荷重发返回逐字节相同响应，effect 只发生一次（1 event / 1 outbox / 1 command，经原始 SQL 计数）；同键异载荷 `IDEMPOTENCY_CONFLICT`，异主体同样拒绝。
- **AC-056**：长模型调用在飞时命令 <1s 返回且不入队；邮箱项数/字节超限 `BUSY`、排空后可再准入；>100ms 命令产生诊断；失败命令不阻塞队列。
- **AC-059/AC-060**：软限 2 MiB 合并去重临时帧、硬限 8 MiB 关闭慢连接且持久事件仍可被其它订阅读到；作用域变更返回新快照 + 新水位（快照+C 无缺口）；空批次也发水位；ack 回退拒绝并钳制；游标截断 `RESYNC_REQUIRED`。
- **AC-065**：checksum 不一致/版本超前停止启动；失败迁移回滚且不留部分表；迁移前按来源版本备份（0 字节残留被替换、有效副本复用、原子发布）；迁移 0001 校验和冻结并加护栏（`8de04150…`）。
- **AC-078**：安装凭证 0600 且只显示一次、重载不可复现；Bearer timing-safe；登录 cookie `HttpOnly; SameSite=Strict`（remote 加 `Secure`）、24h 过期、失败 401 与每 IP 每分钟 5 次 429、logout 清会话；写请求 CSRF 与 Origin 精确匹配（403）。传输层子句归 WP-09。
- **AC-092**：同一记录重复导入不产生第二次写入；同 recordVersion 异内容或更旧版本 → 冲突且**不改行**，只写 `requirement.save_failed` 诊断；行写入与事件写入在同一事务；`metadataHash` 可按 `requirement.json` 原始字节计算。Git 往返子句归 WP-04/WP-08。

## 5. 规则与合规核对

- 路线：L2 代码路线（Product 基线已有效 → Plan → Develop → Review → Test → Settlement）；`plan.md` 含任务 DAG、写入范围、验收映射、验证策略与回退。
- 独立上下文：三次 Review/复评与两次 Test 均为独立 agent、不读开发聊天、自行复跑命令并在仓库外副本做变异实验；Reviewer 只追加 `review.md`，Tester 只重写 `test-report.md`。
- 失败如实上报：未实现命令按契约退出 1；每轮 Review FAIL 均返工并再次独立复核；未覆盖项与残余 P3 显式登记（`test-report.md` §8、`discovery.md` DC-26）。
- 契约优先：需求记录路径、`assessment` 不可变、`operation.kind` 枚举、Project 方法必填 `projectId` 均以 `docs/**` 原文为准修正，未以外部同名 skill 或历史方案替代。
- `docs:check` 通过；本包未改动产品语义或规则文档。

## 6. 未覆盖、残余与移出本包

| 项 | 处置 |
|---|---|
| AC-078 传输层子句、EventHub WS 绑定、AC-023 运行时切换、`connection.hello`/`project.open` 注册 | 移出：**WP-09**；WP-10 复验（DC-24） |
| AC-092 Git 往返、`REQUIREMENT_PATH_IGNORED`/`LEGACY_REQUIREMENT_FORMAT`、跨服务器 recordHash 调用方 | 移出：**WP-04/WP-08**；WP-10 复验（DC-23） |
| `project.create` 的 `name` 字段（protocol §3 与 data.md 不一致） | 记录待产品/协议确认：**WP-09**（DC-18） |
| `planSchema` 未表达非 L1 需 `productRef`、L3 `rollback` 非空 | 记录：**WP-02/WP-06** Gate 落地（DC-19） |
| 迁移 0001 在首个发布前就地修正（校验和变化，无已发布库） | 记录并冻结：后续 schema 变化必须追加新迁移（DC-20） |
| 备份护栏 4 项 P3 残余（显式 `backupPath` 跨版本复用、1 字节残留、`.partial` 垃圾、内存库裸 `ENOENT`） | 记录：**WP-09** 接线时一并收紧（DC-26）；不阻断本包 |
| `system.ts` 注释 "eight operation kinds"（实为 7） | 文案瑕疵，随下次触碰该文件时修正 |
| 真实 Provider 纵向运行、`test:e2e`/`test:acceptance`/`test:live` | **WP-09/WP-10**（DC-25） |

## 7. 证据 Hash

| 工件 | SHA256 |
|---|---|
| `plan.md` | `51d5c383040722f633b7410be1e162c387ee0c0511c91f256cb9bed49b98cadc` |
| `implementation.md` | `48430c27a48560ab2de85db8fabf95accd6d841e75bc78e932c606266172dce2` |
| `discovery.md` | `840c422ac0818252006c12c597ff5606a155cf3f6e5b7d30b28b6cf53661188e` |
| `review.md` | `053faae816d9979d52f9ee2dde3507987f1506d690a5f59aea48fff5bee1386b` |
| `test-report.md` | `54108ebfeb0a91b868cd4c2d42ba3f917bae395273cb955bf2e11a8a09db703e` |

## 8. 最终完成清单

1. `contracts`/`domain`/`storage`/`core` 四个包按 WP-01 计划落地：28 张表的契约与 DDL、单项目单库迁移、版本 CAS 仓储、幂等账本、事件日志与订阅、outbox/租约/blob、串行邮箱与命令分发、认证与身份、需求投影。
2. 十个工程命令按契约就位：已实现者真实通过，未实现者按契约失败并点名工作包（§2）。
3. AC-023/024/055/056/059/060/065/078/092 在本包必验范围内均有可复现证据；超出范围部分显式移出并登记归属（§4、§6）。
4. 独立 Review 与 Test 在冻结点 `c201f42` 上给出一致 **PASS**；此前三轮 FAIL 的发现全部修复或按记录移交，残余仅 5 项 P3 且不影响验收（§3、§6）。
5. 回退：`git revert e02fb8e 9c634f0 8e96ee2 c3a581f fc8260f 722b60d dab17f9` 或直接回到基线 `79d5895`；本包不修改已发布契约、无数据迁移不可逆风险（新建库）。

结论：**WP-01 达到退出条件，可进入结算提交；下一工作包按依赖顺序为 WP-02（Work/Run 状态与执行编排）。**
