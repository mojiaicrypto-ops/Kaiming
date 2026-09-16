# WP-12 项目 UX：浏览器内加载与切换项目

- 状态：Developing（证据段在门禁跑完后填写；本文件为唯一交付记录）
- 上级依据：`.agentdev/work/WP-12/product-completion-plan.md`、`.agentdev/work/WP-12/T5-plan.md` §15 裁决（单入口 BFF、按 `projectId` 路由、`project.close` 为导航级且 live Run 存在时拒绝、`project.clone` 需要安装级 once-Grant、per-root 锁在 `~/.agentdev/locks/`、产物 URL 携带项目）、`docs/product/experience.md` §1/§2、`docs/architecture/protocol.md` §1–§5、`docs/architecture/reliability.md` §7。
- 范围：`apps/daemon/src/{main,protocol,project-directory}.ts`、`apps/web/**`、`tests/browser/**`、`apps/daemon/test/**`、`docs/product/experience.md`、`docs/operations/installation.md`。
- 无新增运行时依赖、无迁移、无 `git commit`。`scripts/**` 与 `docs/delivery/**` 未改动；`scripts/lib/drill-acs.mjs` 未追加（本切片没有新增 AC，规格的 AC id 只作标题标注）。

---

## 1. 交付的流程（用户面）

```
agentdev start（无 --root，空安装）
  └─ BFF 起来（即使一个项目都没有）
       └─ 浏览器 http://127.0.0.1:4317 → 登录（无项目 daemon 也能登录）
            └─ /projects 首次引导：打开文件夹… / 新建项目文件夹… / 从 Git 地址克隆
                 ├─ 打开文件夹… → 全局文件夹选择器（主目录起点、可到 /、可粘贴路径）
                 │     └─ 选中 → project.open（默认 false=未信任，只读）
                 │           └─ 未信任过 → 只问一次「信任并开始工作 / 暂时只读」
                 │                 ├─ 信任 → project.trust{trusted:true} → 进入该项目
                 │                 └─ 只读 → project.trust{trusted:false} → 进入该项目（只看不改）
                 ├─ 新建项目文件夹… → 选择器选空目录 + 输入名称 → project.create
                 │     （空目录建初始 Git 与 agentdev/main；创建动作本身即授权）
                 └─ 从 Git 地址克隆 → 远 端 URL + 目标目录 → project.clone
                       （BFF 用这次显式提交铸一次安装级 once-Grant 并立即消费）
            └─ 项目行上的真实动作：切换 / 信任↔只读 / 初始化 / 关闭（导航级）/ 打开（已关闭）
```

四个状态的展示是诚实的（`docs/product/experience.md` §1/§2 已同步）：**还没有项目**（首次引导）、**正在打开**（`projects.opening` + 结果区）、**已打开**（`lifecycleState=open`，可切换）、**未信任所以只读**（`data-trust="untrusted"` + 文案 “read-only (untrusted)”）、**失败**（`CODE: message — operationId`）。零项目时顶栏与侧栏不再渲染 `/projects/project/chief` 这类死链（`shell.ts` 的 `projectHref`/`navItem`）。

## 2. 选择器的确切契约

**端点**：`GET /picker/list[?path=<绝对路径|~…>]`，BFF 专属路由，在 `handle()` 里早于方法守卫处理（`apps/web/src/app.ts`）。

| 维度 | 契约 |
|---|---|
| 认证 | 必须有 BFF 浏览器会话（`agentdev_web` cookie）；否则 `401 UNAUTHENTICATED`。GET 读，不需要 Origin 门（写才有）。 |
| 方法 | 只读：非 GET/HEAD 一律 `405 VALIDATION_ERROR`，不落到任何列表逻辑，也不写审计。 |
| 默认路径 | 省略 `path` → 进程 home 目录（`os.homedir()`，不是安装目录 `~/.agentdev`）；`~`、`~/x` 展开为 home。 |
| 路径规则 | 必须绝对（相对路径 → `422 VALIDATION_ERROR` + `details.reason='not-absolute'`）；`resolve` 归一化后 `realpath` 规范化（`/var` → `/private/var`）；不存在 → `404 NOT_FOUND`；是文件 → `422 VALIDATION_ERROR` + `details.reason='not-a-directory'`。**没有声明范围，也没有拒绝清单**（按产品负责人指示，见 §5）。 |
| 响应 | `{path, parent, entries:[{name,isDirectory,hidden}], truncated}`。`parent` 在 `/` 为 `null`（可上溯到根）。目录项按名称排序；符号链接指向目录时 `isDirectory:true`（可进去）。 |
| 大小 | 单层 `readdir`，**不递归**；条目上限 `PICKER_MAX_ENTRIES=2000`，超出置 `truncated:true`；只用名称/目录位/隐藏位，不含大小、哈希或内容。 |
| 审计 | 每次列表**与每次拒绝**都先写审计再应答（写不进就拒绝服务）：`~/.agentdev/logs/picker-audit.jsonl`（0600，JSON Lines）。字段固定为 `{at, sessionId, requested, path, outcome:'listed'\|'refused', code, entryCount}`；`sessionId` 是 BFF 浏览器会话 id（`protocol.md` §2 的审计主体），`at` 为 UTC ISO。 |

代码位置：契约与实现在 `apps/web/src/picker.ts`（`NodeFolderPicker`、`canonicalDirectory`、`PickerRefused`），注入点在 `apps/daemon/src/main.ts`（构造 `NodeFolderPicker` 并挂审计 sink），路由在 `apps/web/src/app.ts`。

### 2.1 为什么 Agent 用不到它（安全论证，逐条可指代码）

1. **它不是协议方法。** 选择器不是 `WorkbenchProtocol` 的 case，也不在 `GLOBAL_METHODS`/`WRITE_METHODS`/`INSTALLATION_METHODS` 里；`apps/web/test/picker.integration.test.ts` 断言 `isInstallationMethod('picker.list') === false`。`/rpc` 是按 `method` 派发的，模型即便构造信封也没有可命中的方法。
2. **它不是工具。** Agent 的工具面是 Runner 的固定并集 `BROKER_TOOLS = read/search/edit/write/bash/git/artifact_write`（`packages/contracts/src/tool-protocol.ts`），Runner 的 allowlist 由同一常量派生；该并集里没有任何目录列举工具，本切片也没有向其中加入任何名字（同一测试断言这 7 个名字）。工具调用走 Runner → 控制面（control-http，按 Attempt capability 鉴权），BFF 的路由从不被这条通道代理。
3. **模型拿不到会话。** 选择器要求 `agentdev_web`（HttpOnly，BFF 内存会话）与安装凭证；两者都不进模型上下文，BFF 也从不把它转发给模型。
4. **守护端口是固定拒绝项。** BFF 的**实际**端口注册进 `egressPorts`（`main.ts`），工具的准入层 `NetworkPolicy` 对「守护自身端口」是 `details.approvable=false` 的硬拒（不可授权），因此 `bash` 里出现 BFF 的字面 URL 在准入前就被拒。
5. **即使被读到，也读不到内容。** 代码只调用 `readdirSync` 与 `statSync`，模块内没有 `readFile`；条目对象只有三个字段。

**诚实边界（不夸大）**：宿主模式下 `bash` 与用户共享文件系统与 `~/.agentdev/installation-token`（0600），所以「人专属」是**结构性**的（不是工具、不是协议方法、端口被硬拒、无内容可读），不是与宿主 shell 的密码学隔离；容器运行环境更强。这与 `docs/architecture/execution.md` 已登记的宿主模式残余风险一致。

## 3. 信任提示现在的行为

- **默认只读**：`project.open` 的 `trust` 缺省为 `false`（`apps/daemon/src/protocol.ts` 与 BFF 的 bootstrap 路径一致），即新打开的文件夹先进入「只看不改」；要受信任必须由一个显式动作完成。这与 CLI/管理面 `agentdev open`/`POST /projects` 的缺省一致，修掉了浏览器路径原先硬编码 `trust:true` 的不一致。
- **只问一次**：项目打开后如果还不是 `trusted`，`/projects` 弹出一次二选一：「信任并开始工作」（`project.trust{trusted:true}`）/「暂时只读」（`project.trust{trusted:false}`）。选择写库（`projects.trust` + 注册表），并在本浏览器记一个标记避免重复打扰；换浏览器会再确认一次（选择本身仍在服务端）。
- **随时可改**：项目行上始终有「信任 / 改为只读」按钮，状态以 `data-trust` 与文案（`trusted` / `read-only (untrusted)`）如实展示。
- **不洗白**：`ProjectDirectory.open` 对已打开项目幂等、忽略 `trust` 参数，因此反复 `project.open` 不会把已撤销的信任变回 trusted（`apps/daemon/test/project-bootstrap.integration.test.ts` 有正反两向断言）。
- **准入已接通（WP-12 trust-enforcement，本切片补）**：本切片原先只产出/展示/切换信任事实，未把它接进写准入。已补齐：`prepare-run.ts` 从项目行读取信任并写入每 Attempt 的 `trust.json`（记录该 Run 以何信任状态运行），`runner-spawn.ts` 仅在 trusted 时向 Runner 传 `--trusted`（未信任 ⇒ `createExplicitResources` 不加载项目自带的指令/扩展资源），`tool-handler.ts` 在**任何副作用之前**（早于 workspace resolve / Plan gate / 单写者 lease / Broker）用 `permissions.ts` 的 `decideTrustAdmission` 拒绝 untrusted 项目的 mutating 工具（`write`/`edit`/`bash`/`git`/`artifact_write`），`Broker.invoke` 与 `runDeclaredTestCommand` 各自复检同一规则，拒绝写一条带 `trust` 的 `tool.refused` 审计。真实双向演练见 `.agentdev/work/WP-12/trust-enforcement.md`。

## 4. 真实证据

全部在**同一棵冻结树**上按顺序跑（唯一写者；跑完只再改本记录，而 `.agentdev/work/**` 不在验收 binding 的 `CODE_PATHS` 内）：

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0（ESLint type-aware + Prettier `--check .`） |
| `pnpm test:unit` | 80 文件 / 1494 用例，0 失败，exit 0 |
| `pnpm test:integration` | 62 通过 + 1 跳过（63 文件）；564 通过 + 6 跳过（570 用例），0 失败，exit 0 |
| `pnpm test:e2e` | 31 checks — PASS 30 / FAIL 0 / UNVERIFIED 1（`provider.fact-and-unknown`，离线演练的既有 UNVERIFIED），35 ACs，exit 0 |
| `pnpm test:browser` | 23 passed（含本切片新增 2 例：`tests/browser/ac-project-ux.spec.mjs`；既有 21 例不改不弱） |
| `node scripts/live.mjs --no-write`（真 Provider） | 连续 3 次：`live: 7 passed / 0 failed / 0 unverified`，exit 0（各约 37–48s，HTTP 全 200） |
| `node scripts/acceptance.mjs` | **`94/94 ACs accounted — PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0`**，`acceptance: OK`，exit 0；binding `sha256:4997c02b4127…`（HEAD `c90ad84`）；内部 `pnpm test:unit`/`test:integration`/`test:e2e`/`test:live` 全 exit 0 |

本切片新增用例：

- `apps/web/test/picker.integration.test.ts`（9 例，真实 BFF + 真实文件系统）：目录名与三字段（无内容、无大小/哈希）、绝对路径与 `..` 归一化、**文件路径被拒**（`VALIDATION_ERROR` + `reason=not-a-directory`）、缺失路径 `NOT_FOUND`、相对路径被拒、非 GET `405` 且不写审计、无会话 `401`、**逐次审计（listed/refused、who/what/when）**、以及「它不是 installation method、Agent 工具并集里没有目录列举工具」。
- `apps/daemon/test/project-bootstrap.integration.test.ts`（5 例，真实 `startRuntime` + 空注册表）：空安装 `instances=0`；BFF 登录页 401 + 无项目也能登录；`/projects` 首次引导且无 `/projects/project/chief` 死链；`project.open` 缺省 **untrusted**、`project.trust` 后才 trusted、再 open 不回退也不洗白（正反两向）；宿主侧选择器可用且 `<AGENTDEV_HOME>/logs/picker-audit.jsonl` 有 `listed`/`refused` 记录；无会话 `401`。
- `tests/browser/ac-project-ux.spec.mjs`（2 例，真 Chromium + 真宿主 + **零项目**安装）：`登录 → /projects 首次引导（无死链）→ 选择器（home 起点、Filesystem root、粘贴路径、文件路径被拒且不回显正文）→ 新建项目 → 打开已有仓库 → 一次信任提示 → 切换两个项目 → 项目行上改回只读再信任`；以及 `暂时只读` 分支落库后项目行 `data-trust=untrusted`（只看不改）。

**过程中出现并已定性的红**：第一次 `node scripts/acceptance.mjs` 报 2 FAIL（AC-080 等），根因是既有偶发失败 `apps/daemon/test/tool-permission-runner.integration.test.ts :: in-envelope shell execution with a real Runner child`（`hardening-plan.md`/`product-completion-plan.md` §2 已登记的 Runner 竞态）。该用例单独复跑立即通过（2587ms），随后同一棵树完整重跑 acceptance 为 `PASS 94 / FAIL 0`。这是**预先存在的偶发**，不是本切片引入；按「单次红须复跑取证再定性」的口径登记在此。

## 5. 未决与已登记偏离

1. **选择器不加拒绝清单（产品负责人已裁决：不加，本切片不改）**：选择器保持「必须已存在目录」+「只列名称不读内容」+ 逐次审计，**不加**任何凭据目录排除清单，也不加可配置根范围。裁决理由：它是一次只读、只由登录的人触发、逐次落审计的目录名列举，不是 Agent 可达面（不是协议方法、不是工具、需要浏览器会话、无内容可读，见 §2.1）；诚实边界是**宿主 shell 与用户共享同一文件系统**——能开宿主 shell 的人本来就能 `ls` 这些目录，因此加清单只制造安全错觉而不改变真实暴露面（容器运行环境另论）。若产品日后仍要求最小暴露面，应作为独立策略位（可配置根范围）另行裁决，而不是在 UI 切片里悄悄加一张清单。
2. **BFF 在「空安装窗口」代答项目生命周期命令是有意为之（产品负责人已确认，保留）**：`project.list/open/create/clone/trust/close` 正常由某个项目的 daemon 委托给宿主的 `ProjectDirectory`；空安装**没有** daemon 监听，首个文件夹永远打不开，首跑流程会死在这里。因此当 `projects.list()` 里没有任何 `open` 条目时，BFF 用同一个 `ProjectDirectoryPort` 就地完成同样的委托，并按 `protocol.md` §1 的响应封套回答（成功 `{ok:true,result:…}`）。约束（都是现状，不是新策略）：**同一个 `AuthService`**（同一凭证常量时间比较、同一 5 次/分钟限流）、**同一 Origin/CSRF 规则**（精确 Origin 的同源写，HttpOnly `agentdev_web` 会话）、**只代答安装级方法**（`GLOBAL_METHODS`/`INSTALLATION_METHODS`，不是任意 `/rpc` 方法）、**宿主目录始终是唯一写者**（第一个项目打开后命令立即转发给 daemon）。代价：该窗口内没有项目库可记录 `project.open` 的幂等键（每条命令自身幂等：`open` 幂等、`create` 拒绝非空目录、`trust/close` 是状态写入）。
3. **空安装窗口的登录**（登记偏差）：`agentdev start` 无项目时没有 `/auth/login` 可达，BFF 会用宿主已共享的同一 `AuthService` 受理登录（同一凭证常量时间比较、同一 5 次/分钟限流、同一精确 Origin 规则），产出的会话就是之后每个项目 daemon 都认的会话。有任一项目打开后，只有 daemon 登录这一条路径（daemon 坏了不会被掩盖）。
4. **`project.clone` 的 Grant 铸造**（Q4 的落地方式）：CLI 经回环 admin 面铸 Grant；浏览器没有 CLI，因此 BFF 在收到**这次**已认证、精确 Origin 的显式提交时用 `directory.grantClone({remoteUrl, root})` 铸一次安装级 once-Grant 并立即消费。调用方自带 `grantId` 时仍原样转发给 daemon（协议面语义不变）。
5. **`project.initialize` 的 `sourceMessageId`**：协议要求必填。项目行的「初始化」按钮以 `web-project-initialize-<ts>` 记录这次用户动作（`authorizationRef`）。若产品要求「必须是真实用户消息」，需要给该项目级动作补一条 user Action 记录。
6. **`project.open` 新增可选 `trust` 参数（已补文档）**：`protocol.md` §3 的 `project.open` 行现为 `root:string,trust?:bool`，并在同节补了「`trust` 参数与只读准入」一段（缺省 false、对未打开的 root 生效、已打开幂等忽略、未信任的 mutating 工具拒绝形状）。
7. **未做的相邻项**：`project.initialize` 在空安装窗口下返回 `INVALID_STATE`（没有可初始化的项目）；`project.clone`/`create` 的进度仍是一次性结果（不流式）；选择器无键盘快捷键/无「显示隐藏文件」开关（隐藏项默认列出并标注）。

## 6. 改动文件

- `apps/web/src/picker.ts`（新）：选择器契约、路径归一化、审计记录类型。
- `apps/web/src/app.ts`：`WebAppOptions.picker`、`GET /picker/list` 路由、空安装窗口的登录与项目命令代答。
- `apps/web/src/projects.ts`：端口新增 `grantClone`。
- `apps/web/src/{pages,shell,i18n,index}.ts`：`/projects` 首次引导与动作区、选择器/信任对话框、空项目导航修正、新 i18n 键与导出。
- `apps/web/public/{app.js,styles.css}`：`initProjects()`（选择器、信任、行动作、克隆）与样式（含 `[hidden]` 兜底）。
- `apps/daemon/src/main.ts`：构造并注入 `NodeFolderPicker` 与 `~/…/logs/picker-audit.jsonl` 审计 sink。
- `apps/daemon/src/protocol.ts`：`project.open` 可选 `trust`、缺省未信任（与 daemon 的 `UI_STRINGS` 同步新键）。
- `apps/web/test/picker.integration.test.ts`（新，9 例）、`apps/daemon/test/project-bootstrap.integration.test.ts`（新，5 例）、`tests/browser/ac-project-ux.spec.mjs`（新，2 例真实 Chromium）、`tests/browser/stack-runtime.mjs`（新增 `openEmptyStack` 零项目夹具）。
- `docs/product/experience.md`、`docs/operations/installation.md`：按上面交付的流程同步。

### 6.1 后续切片（trust-enforcement）追加的文件

详见 `.agentdev/work/WP-12/trust-enforcement.md`：`packages/core/src/{permissions,broker}.ts`、`apps/daemon/src/{prepare-run,runner-spawn,tool-handler,main,protocol}.ts`、`apps/web/src/{i18n,pages}.ts`、`docs/architecture/protocol.md`，以及新增/更新的测试（`apps/daemon/test/trust-enforcement.integration.test.ts`、`packages/core/test/trust-admission.test.ts`、`apps/daemon/test/runner-spawn.test.ts`、`apps/web/test/pages.test.ts`、`apps/daemon/test/{tool-bridge,tool-permission-runner}.integration.test.ts`）。
