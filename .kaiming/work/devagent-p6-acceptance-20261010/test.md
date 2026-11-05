# Test · devagent-p6-acceptance-20261010

产品验收 `docs/productnew/acceptance.md` 逐项结论。每项写“实际用户输入 / 可见结果 / 必要证据”，未执行的写 not_run 与原因，**不把未执行记成通过**。

## 0. 环境（每项场景独立准备，不借用上一场景状态）

- 实例：真实 `node src/server/main.ts`（`AGENTDEV_PORT=4310`，数据目录 `/tmp/p6/data`），**真实模型** deepseek-flash（`<dataDir>/models.json` 写入 provider/baseUrl/apiKey）。
- 第二实例（无模型）：`AGENTDEV_PORT=4311`，数据目录 `/tmp/p6/data-nomodel`，不设 `MODEL_*`。
- 项目：A（有代码 + 有文档 + Git：`AGENTS.md`、`README.md`、`docs/INDEX.md`、`src/account.js`、`src/account.test.js`）、B（第二个项目，独立内容 + Git）、N（**无 Git**）。
- 浏览器：真实 Chromium（`browser` 工具），1440×900。
- 夹具事实：项目 A 的“账号服务”取自产品文档自己的例子（`journeys.md:21`、`README.md:78-82`、`AC-09`、`project-knowledge.md:44`），不是 AgentDev 自身的用户体系——AgentDev 无账号系统（`README.md:32` 明确把团队账号/多用户排除；`auth.ts` 只有一个访问口令，库中无 users 表）。

## 1. 逐项结论

| 编号 | 结论 | 证据 |
|---|---|---|
| AC-01 | **pass** | 真实 Chromium 经顶栏对话框输入 `/tmp/p6/projects/A` → 顶栏显示 `A` + 真实路径 `/private/tmp/p6/projects/A`；同一目录重复打开 10 次全部回到同一 projectId `p-051f7ff4ffbd`（服务端 receipt 可查），不重复建项目；随后以真实 UI 依次打开 B 与 N：B → `p-617c79822375` / `/private/tmp/p6/projects/B`（自己的会话、需求 0、Task 0），N → `p-3508b410d2a6` / `/private/tmp/p6/projects/N`（同样独立），同一实例同时管理三个项目，各项目内容互不串；`project.get` 返回 `entries`（`AGENTS.md:true`、`.dev/INDEX.md:false`、`.dev/PROJECT.md:false`）；项目 A 结束时 `git status --porcelain` 只有 `?? .dev/`，**没有改动任何代码** |
| AC-02 | **pass** | 无模型实例：打开 A 后仍能读需求（`REQ-PASSWORD-RESET-001`）、读文件（6 项）、读会话历史；提交消息后输入停在 `queued`、助手消息 0 条，界面给出 `MODEL_UNAVAILABLE: unset/unset has no usable credential`（不伪造 AI 回复）。无效目录由服务端 `PROJECT_UNAVAILABLE` 路径覆盖（`test/server-read.test.ts`），P6 未重复 |
| AC-03 | **not_run** | 入口文件（AGENTS/`.dev/INDEX.md`/`.dev/PROJECT.md`）的“先讨论 → 展示差异 → 用户确认 → 建立”流程本轮未在浏览器走；现状：两个 `.dev` 入口不存在（`project.get` 如实报 missing），未建立也未迁移任何东西 |
| AC-04 | **not_run** | `project.rebind` 只有服务端方法，浏览器无入口（`grep` 全 web 无调用），无法在 UI 层执行“移动目录后重绑定” |
| AC-05 | **部分 pass** | 同一项目多段主管会话：切换器列出真实会话（`Chief · e737de`、`Chief · e49bbc`，以及被委派的 `Investigator · 6889a7`），切换后各自聊天独立保留（19 条 / 102 条记录 / 21 条），项目归属相同；只读调查 Task 只挂在被操作的那段会话上。**未执行**：AC-05 中“某段会话有等待/暂停的 Task 时提出另一目标”这一分支（本轮唯一 Task 是 `completed`，没有 waiting/paused 状态可测，也没有其他话题被提出） |
| AC-06 | **pass** | 说“只给建议，不要开始实现”后，主管只讨论/只读调查：建立**只读 Task** `t-c919c3fb`（type=read），Plan 落在 `<dataDir>/work/t-c919c3fb/plan.md`，调查报告落在 `.../s-0a6889a7/r-ac4e88e4ab702716.md`；项目文件保持原样（`git status` 仅 `.dev/`）；报告明确区分“已确认缺失（有文件证据）”与“未验证”，对无执行能力如实写 `not_run`；主管另外主动指出“我只能看到本会话内容，没有更早的讨论”，**没有假装记得另一段会话** |
| AC-07 | **pass** | 先整理、再明确确认：浏览器 `confirm` 卡片“确认保存：REQ-PASSWORD-RESET-001”→ 点 Confirm → 工具返回 `Requirement REQ-PASSWORD-RESET-001 (proposal, pending) saved`；文件 `.dev/requirements/REQ-PASSWORD-RESET-001.md`（front matter 合规、kind=proposal、status=pending、8 条未知项保留）；需求列表出现该记录；未启动开发 |
| AC-08 | **not_run** | 需求列表/筛选/非法文件上报在 P4 记录中已有服务端与浏览器证据；版本 CAS、冲突、损坏 id 修复路径仅由单元测试覆盖，本轮未在真实浏览器重复 |
| AC-09～AC-18 | **not_run** | 需要“提案 → 设计角色 → 实施需求 → 开发 Task → Review/Test/Settle”完整链路；本轮在真实模型下只走到只读调查 Task，未走开发链路（各 AC 另需：AC-10 实施 Task 与 `.dev/work/<taskId>/plan.md`、AC-11 重复启动/第二目标、AC-12 逐计划确认与范围新增、AC-13 轻量改动、AC-14 阶段推进与 Review/Test 独立执行、AC-15 文档交付、AC-16 缺陷返工、AC-17 多 Review 与等待范围、AC-18 失败/未覆盖如实登记） |
| AC-19 | **not_run** | 运行中暂停/继续/取消未在浏览器执行（窗口内没有可控制的 Task）；服务端 `task.control` 与 `input.stop` 由既有测试覆盖，`STOP` 按钮本轮已在 D3 接上 |
| AC-20 | **部分 pass** | 真实模型在浏览器提问（`confirm` 卡片“确认 Plan：只读调查账号模块现状”，含类型/目标/范围/依据）→ 点 Confirm → 模型继续并建 Task；同一会话 3 次提问-答复往返；答复前模型保持等待（`activity=running`、`pending=1`），答复后原调用继续；委派期间父会话输入 `c-mv1x96g5-14-803cc1` 直到 investigator 结束才 completed（investigator 自己的委派输入 `i-3a5e0bbe` 于 05:09:37 completed，父输入 05:10:05 completed）。**未执行**：AC-20 中“子 Session 在同步委派期间提问、经主管协作入口呈现”这一分支——本轮 4 次交互全部属于主管会话本身（`interaction` 行的 sessionId 都是主管会话），investigator 的转录里没有 question 调用；重复提交同一答复与过期选项也未在浏览器测（`INTERACTION_STALE`/幂等由服务端测试覆盖） |
| AC-21 | **部分 pass** | （a）**关浏览器再开**：关掉标签页后重开（真实浏览器会保留 localStorage；本工作台的托管标签页各用独立 context，故按真实浏览器语义先保留再恢复 `agentdev.projectPath/projectId/sessionId`）→ 项目 A、同一会话、21 条消息与助手最后一段文本全部回来，切换器列出三段真实会话。（b）**真停服务再启动**：新进程打印 “1 input(s) from an earlier run are now interrupted and await verification”；该会话 `recovery.inspect` 报 `interruptedInputs:[c-mv1tac4f-…]`；旧提问被置 `stale`；重启后重新登录→项目/会话/需求/历史全部保留（`state.db` 与原文件 md5 相同）；核实后继续，未重放已知成果。**未执行**：委派进行中“问状态/提供信息”的分支 |
| AC-22 | **pass** | Inbox 明确显示中断输入，要求选择结论并填写核实依据；无依据不允许核实（服务端 `PI_INPUT_UNCONFIRMED`，既有测试覆盖）；本轮如实选择 `stopped` 并给出依据（历史以一次未完成的 requirement 读取结束、`REQ-PASSWORD-RESET-001` 当时不存在、未写出需求文件），核实后会话恢复可继续 |
| AC-23～AC-26 | **not_run** | 结算报告/知识更新/归档、本机保存与重试、新会话接续、交接：本轮未走完一条写 Task 的交付闭环（无 Task 可结算）；`session handover` 未实现（无方法），归档只有 `status=archived` + `sourceRequirementIds` |
| AC-27 | **部分 pass** | 未登录调用被拒（`log in first`）；重新登录后旧页面可继续操作；服务重启后必须先重新登录（凭证为进程内存态，见“风险处置”）；真实模型可用性由真实运行证明（deepseek 可达并完成多轮工具调用）；`config.get` 如实回报配置且凭证只以引用形态出现（`credentials:{mode:reference,inResponse:false}`）；**无效模型实测**：以 `deepseek/not-a-real-model` 启动，`config.get` 回报该配置，提交后 toast `MODEL_UNAVAILABLE: deepseek/not-a-real-model has no usable credential`、助手消息 0 条（另一实例以 `unset/unset` 同样验证）。**未执行**：角色级/项目级模型覆盖（当前无该入口，`methods.ts` 只报默认值并注明覆盖属后续切片） |
| AC-28～AC-35 | **not_run** | 需要设计角色/知识体系/提案归档合并/交接的完整链路；本轮未执行，理由同 AC-09～AC-18 |

## 2. 本轮修复后的回归证据（真跑）

```
tsc --noEmit                      0
npm test                          209/209（19 文件，含新增 test/web-i18n-keys.test.ts 5 项、store 1 项、requirement 3 项）
npx playwright test               8 passed（真实 Chromium + 真实服务进程 + stub 模型端点）
npm run check:prompts             15/15
npm run spikes                    47/47
node checks/runner-real-model.ts   4/4（真实模型）
node web/styles/verify-selectors.mjs  485/485，extra 0
```

- 字典规模：399 → 251 键（删 177、增 29，两语言对称），全部有渲染路径；`data-i18n-placeholder` 生效。
- 字典契约用例经变异验证：删掉 `inbox.questions` 后“键解析”断言必须失败（改前它能带着这个 bug 通过）；该断言现已覆盖“经 helper 传参”的键（`section('inbox.questions', …)`），RPC 方法名（`auth.logout`/`requirement.get`/`requirement.list`）显式列白。
- 阻塞原因只发布一次：14 秒（约 50 次 worker 轮询）内 `blocked` 帧数 = 1、toast 1 条、控制台 1 行（修复前约 4 帧/秒）。

- 八视图真实数据扫描：八个视图的可见文本里**没有**任何字典键字面量（修复前 Inbox 会显示 `inbox.questions`/`inbox.recovery`）。
- 无模型实例：提交后 toast `MODEL_UNAVAILABLE: unset/unset has no usable credential`，助手消息 0。
- 真实模型链路：`requirement` 以 `{interactionId}` 授权保存成功（修复前被工具拒绝）。
- 备份/恢复：tar → 删目录 → 解包 → 重启，`state.db` md5 一致、浏览器读回项目/会话/需求。

## 3. 未执行与风险处置

- **未执行**：AC-03/04/08/09～AC-19/AC-23～AC-26/AC-28～AC-35（原因见上表；多数依赖“设计 → 实施需求 → 开发 Task → Review/Test/结算”的完整闭环）。
- **环境阻断**：无。
- **明确允许的风险处置**：访问凭证为进程内存态会话，重启需重新登录（首版范围；文档只要求“进入需访问校验、退出后不能继续以已登录状态操作”）。若要求凭证跨重启持久，须另立需求。
- **未实现的能力（如实登记，不计入通过）**：会话交接、`task.reconcile`、知识入口自动建立、需求归档/合并专门操作、`project.rebind`/`session.cleanup` 的浏览器入口。

## 4. 待独立审阅

- 本页每一条结论都必须能被审阅者在工作台/文件系统里复核；审阅者不应读本任务之外的开发聊天，只按本页与产物核对。
