# WP-03 结算（Settlement）

- 工作包：WP-03 直接协作与说明产物（`docs/delivery/implementation.md`）
- 等级：L2；Plan `.agentdev/work/WP-03/plan.md`（**planVersion 7**）
- 关联验收：AC-001、AC-002、AC-003、AC-004、AC-005、AC-006、AC-052、AC-076、AC-084
- 基线提交：`f9b61e0`（WP-02 结算）
- **验证代码树：commit `7512159`，tree `253c99d9f2c78863586a70b2d5f7eba3cae48841`**
- 证据提交：`309e74c`（独立 Test 第一轮报告，PASS）、`eefc7f4`（Review 第二十轮 PASS）、`3b3389d`（Review 第二十一轮 PASS + 记录订正）；本结算提交只新增/更新 `.agentdev/work/WP-03/` 与 `docs/INDEX.md`，**代码树未变**
- 证据目录：`.agentdev/work/WP-03/`（plan / implementation / review / test / settlement；本包未单独建 discovery.md，发现项按 T1～T29 记入 `implementation.md`）
- 冻结提交总数：`f9b61e0..7512159` 共 47 个提交；Diff **19 个路径、+5895/−1**

## 1. 实际 Diff

| 类别 | 内容 |
|---|---|
| 领域路由 | `packages/domain/src/requests.ts`（新增，594 行：确定性 Chief 路由 `routeMessage`、`splitClauses`、命令文法、拒绝/陈述/条件/意见标记、`pathsIn`）、`packages/domain/src/index.ts`（导出） |
| Core 协作面 | `packages/core/src/attachments.ts`（staged 上传、限制矩阵、TTL、原子单次绑定、删除与过期清理）、`packages/core/src/artifacts.ts`（版本链、创建/失效、ACL、`artifact.created/invalidated`）、`packages/core/src/preview.ts`（隔离策略、截断阈值、60 秒单次下载 token）、`packages/core/src/messages.ts`（`conversation.message.send` 事务：消息 blob、Work 生成、附件绑定、user Artifact、消息来源授权与 Assessment）、`packages/core/src/identity.ts`（`userIdFromSubject`）、`packages/core/src/index.ts`（导出） |
| daemon HTTP 面 | `apps/daemon/**`（新增 workspace：`POST /artifacts/upload`、`DELETE /artifacts/uploads/:id`、`GET /artifacts/:id/preview`、`GET /artifacts/download/:token`、`POST /artifacts/download.prepare`、`GET /healthz`、`POST /conversation.message.send`，含 multipart 解析、Bearer 校验、幂等账本、错误映射） |
| 测试 | `packages/domain/test/domain.test.ts`（路由语料 205 例）、`packages/core/test/artifacts.test.ts`、`apps/daemon/test/server.test.ts` |
| 记录 | `.agentdev/work/WP-03/**`（21 轮独立 Review、1 轮独立 Test、T1～T29） |

`docs/` 只在本次结算更新 `docs/INDEX.md` 的实现状态（技术事实/索引更新，无产品语义或规则改动）。

## 2. 工程命令结果（独立 Test，tree `253c99d9`）

| 命令 | 退出 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | strict 无错误 |
| `pnpm lint` | 0 | 类型感知 ESLint + Prettier 通过 |
| `pnpm test:unit` | 0 | 19 文件 / 289 用例 |
| `pnpm test:integration` | 0 | 10 文件 / 124 用例（含真实 Docker 容器） |
| `pnpm docs:check` | 0 | 15 documents / 55 links / 94 AC / 9 REQ / 11 WP |
| `pnpm build` | 0 | 8 workspace（contracts、cli、domain、storage、core、daemon、pi-runtime、runner） |
| `pnpm test:e2e` / `test:acceptance` / `test:live` | 1 | 按契约 `NOT_IMPLEMENTED`（WP-09 / WP-10） |

Test 自建实验（`/tmp/wp03t/`，外置 vitest 配置、不 import 产品测试文件、真实 HTTP + 真实 SQLite + 真实 blob）：**5 个脚本 / 506 条断言 / 0 失败**。

### 必需失败测试（`docs/delivery/implementation.md` WP-03 第 6 项）

| 必需失败测试 | 覆盖证据 |
|---|---|
| 恶意 HTML | `apps/daemon/test/server.test.ts` 恶意样例预览 + Test 自建 B 组：CSP 逐字、sandbox `allow-scripts`、无 `set-cookie`、`connect-src 'none'`、父页不可达（AC-052） |
| 上传限制 | `packages/core/test/attachments.test.ts` + `apps/daemon/test/server.test.ts` + Test 自建 C 组：每消息数量、单文件 20 MiB、总量、mime 允许集、超限无残留引用（AC-076） |
| 产物生成失败 | `packages/core/test/artifacts.test.ts` + Test 自建 B 组：blob 写入/校验失败（`createUser` 注入）→ 500 回滚、不留 Artifact/Attachment 引用、同附件重试成功 |
| 仅问答无授权写入 | `packages/domain/test/domain.test.ts` 205 例语料 + Test 自建 A/D/E 组：非命令消息零授权行、`level=none`、无写 Run；`level=none` 的 assist Work 不能派发写 Run（AC-004/AC-005） |

## 3. 独立验证

- **Review**：21 轮独立 Review（每轮 fresh context，不读开发/Test 会话；自建探针 + 只读复用前轮探针 + 真实 HTTP + 真实 `Orchestrator`）。第二十轮判 **PASS**（0×P1），第二十一轮针对 P2 闭环提交 `7512159` 判 **PASS**（0×P1）；每轮报告追加保留于 `.agentdev/work/WP-03/review.md`（含附一～附二十）。
- **Test**：第一轮独立 Test 判 **PASS**（0×P1、0×P2、2×P3），代码树 `7512159`；报告 `.agentdev/work/WP-03/test.md`。
- **前后轮阻断项全部闭合**：W3-01 下载 token 可预测/先于认证（P0）、W3-02 产物读取无主体维度（P0）、W3R7-01 只读请求词授权（P1）、W3R16-01 标记豁免（P1）、W3R17-01 否定式报告/前提授权（P1）、W3R18-01 解释领起引用否定（P1）、W3R19-01 未登记否定×未登记变更（P1）等，均在对应修复轮后由下一轮 Review/Test 独立复核为闭合。
- **方向性结论**：路由的 `fail-open` 方向在已登记语料与三组独立探针（route 20 万+ 组合、真实 HTTP、真实 Orchestrator）下为 0；写范围扩张恒为 0（授权路径 ⊆ 消息点名路径）。

## 4. 验收对应

| AC | 题目 | 结论 | 主要证据 |
|---|---|---|---|
| AC-001 | 自由问答 | 通过 | `level=none` 只读 Work、无 Requirement/Gate；文本回答本身属 WP-04/06 |
| AC-002 | HTML 说明 | 通过 | 上传 → 绑定 → 版本化 Artifact → 隔离预览 → 60 秒单次下载；浏览器级渲染归 WP-09 |
| AC-003 | 按需委派 | **部分通过 / 未完全覆盖** | assist/artifact 只读路线与 `level=none` 负例成立；DispatchSpec/快照/独立 Session 属 WP-04/06 |
| AC-004 | 执行授权边界 | 通过 | 非命令消息零授权行、零写 Run（205 例语料 + 真实 HTTP + 真实 Orchestrator） |
| AC-005 | 明确启动 | 通过 | 明确命令 → 消息即授权（L2 + 授权行 + assessment），范围内无重复确认 |
| AC-006 | 混合意图 | 通过 | `解释 X 并修复 Y` → assist + delivery 两 Work，各自范围独立（含 T-04 的 P3 口径） |
| AC-052 | HTML 安全 | 通过（契约/头部级） | CSP 逐字、sandbox、无 cookie、无网络；真实无头浏览器攻防归 WP-09/WP-10 |
| AC-076 | 附件限制 | 通过 | 数量/单文件/总量/mime 客户端与服务端双拒、无残留引用 |
| AC-084 | 首条消息附件 | 通过 | 暂存 → 首条消息原子绑定 → user Artifact；重复绑定 `ATTACHMENT_ALREADY_BOUND`（含 T-05 的 P3 口径） |

## 5. 未决项与承接包（显式登记）

| 项 | 性质 | 承接 |
|---|---|---|
| AC-003 委派实体（DispatchSpec/快照/独立 Session） | 未覆盖 | WP-04 / WP-06 |
| 路由的自然语言语义（未登记措辞、丰富句式） | 已声明的 fail-closed 代价（`plan.md` planVersion 7 逐条登记） | WP-04 / WP-06 模型 Assessment |
| 解释领起良性分支的伪目标边界（裸词 `src`、未列扩展名/全角分隔形态） | 已登记边界（W3R20-01 / W3R21-01，**0 写范围扩张**） | WP-04 / WP-06 |
| `Orchestrator` 级「消息授权 → assess → dispatch」**仓库内**用例 | 未落测试（`apps/daemon` 未装配 `Orchestrator`） | WP-04 接线后补 |
| T-04 解释子句夹带额外内容的 fail-closed 形态 | 已登记已知口径 | 同上 |
| T-05 附件 blob 被外部删除时绑定不校验、缺失在预览/下载以 `ARTIFACT_MISSING` 暴露 | P3 已知口径（无坏字节返回、无残留引用） | 如需启动期校验，随 WP-07 工具层 |
| `protocol.md` 未对账项（未知字段 202 静默忽略、响应多 `workIds`/`authorizationId`、multipart 多文件、错误响应非 §1 封装） | P3 承接 | WP-04 / WP-09 |
| 真实 Provider 纵向、无头浏览器攻防、WS/BFF、交付门禁、工具层权限 | 未实现 | WP-09 / WP-10 |

## 6. 完成清单（CompletionManifest）

- [x] Plan（planVersion 7）与实现记录（T1～T29）齐备，含所有 fail-closed 代价与残余边界
- [x] 独立 Review 21 轮（末两轮 PASS）与独立 Test 1 轮（PASS）报告落库，且代码树在 Test 后未变（`7512159` / tree `253c99d9`）
- [x] 六条契约命令在冻结树上退出 0；`e2e/acceptance/live` 按设计 `NOT_IMPLEMENTED`
- [x] 四条必需失败测试独立复现
- [x] AC-001/002/004/005/006/052/076/084 有证据；AC-003 明确登记为部分覆盖并承接 WP-04/06
- [x] `docs/INDEX.md` 实现状态更新（本次结算唯一 docs 变更）
