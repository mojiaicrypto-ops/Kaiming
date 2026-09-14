# WP-12 T2 安全侧独立复查（Runner→Core 控制通道 + 派生授权）

- 复查对象：`packages/core/src/control-http.ts`、`apps/daemon/src/control-handler.ts`、`packages/core/src/execution.ts`、`apps/runner/src/control-client.ts`、`Orchestrator.assess/assessWithDerivation/dispatchProfessional`、Q1=B 派生授权路径、`stage.submit` 门、`provider.upsert`/`ModelGateway` 凭证解析。
- 依据：`docs/architecture/protocol.md` §2/§5/§6/§7、`docs/architecture/execution.md`、`docs/architecture/reliability.md` §7、`docs/rules/workflow.md` §2–§5、`docs/rules/agents.md`、`docs/product/PRODUCT.md` §5、`docs/product/requirements.md`、`docs/delivery/acceptance.md`（AC-004/005/080/081/085）、`.agentdev/work/WP-12/plan.md` D1b。
- 只读边界：仅写本文件；未读 `T2-implementation.md` 与任何开发聊天；未执行 `git add/commit/stash`。
- 证据口径：单元/集成测试经 vitest 直跑源码；行为探针用 `node --input-type=module -` 直连 `packages/*/dist`（dist 构建于 17:12，晚于源码最后修改 16:59/16:41，且逐条与源码对照）。凡“推理未执行”均在末节标注。

---

## 结论

**FAIL**。控制通道与 Q1=B 派生授权**本体未发现权限提升缺陷**：能力/身份绑定、逐调用复检、拒绝撤销、路径与操作封套、显式授权不可被超越、事务原子性，全部经真实端点/SQLite 复现通过。判 FAIL 的原因是同属 T2 交付的 **G1（P1）：Provider 一旦带 `secretRef`，Gateway 在任何真实安装里都取不到凭证，`conversation.message.send` 无法入队 Chief Run，整条 T2 纵向链路在真实 Provider 下不可用**。该问题由父代理转交并要求独立验证，已在下方独立章节给出复现与修法裁决。

- P1：1（G1，凭证解析 / 链路不可用）
- P2：4
- P3：7

---

## 阻塞发现（P1）

### P1-1（G1）Gateway 对一个带 `secretRef` 的 Provider 永远解析不到凭证

见独立章节「G1 Gateway 凭证解析」。这与 T2 控制通道无关，但它使 T2 全部 Run（Chief 评估 Run、专业 Run）在真实安装下无法入队，属阻断项。

---

## 非阻塞发现（P2）

### P2-1 `agent.dispatch` / `stage.submit` 完全忽略 `operationId`，重放会重复产生 Run / stage_result

- 契约：`protocol.md:115`「内部接口必须有 attempt capability……所有调用带 operationId 以便重派去重」；`plan.md` §2 DoD 第 6 条也要求幂等键可用。
- 实现：`control-http.ts:344-349` 与 `:364-369` 把 body 的 `operationId` 解析出来并传入 handler；但 `control-handler.ts:242`（`agentDispatch: ({ caller, spec })`）与 `:256`（`stageSubmit: ({ caller, result })`）根本没有解构 `operationId`；`Orchestrator.dispatchProfessional`（`orchestrator.ts:638-663`）与 `StageGate.submit`（`stage.ts:111-222`）都没有该参数，因此重放无法去重。
- 真实复现（同一 spec / 同一 result 连发两次）：
  - 直连 Orchestrator：`REPLAY runIds distinct= true`、`REPLAY child runs= 2`。
  - 直连真实端点（`createControlEndpoint` + `createControlHandlers`，同一 capability 连发两次 `stage.submit`）：`PRO stage.submit #1 -> {"status":200,"accepted":true,...}`、`#2 -> {"status":200,"accepted":true,...}`、`PRO stage rows -> 2`。
  - 影响：Runner 的 30s 超时（`control-client.ts:55-56,86-97`，`AbortController` 超时后不重试但模型可重发工具调用）会重复占预算、重复写 `stage_result`、重复触发 `stage.completed`，与 §6 明文契约不符。不构成权限提升。
- 要求修复：三方法都接受并持久化 `operationId`（建议在 `authorizations`/`runs`/`stage_results` 上以 `(run/attempt, operationId)` 唯一约束或 Core 幂等账本），同键同载荷返回原结果，同键异载荷 `IDEMPOTENCY_CONFLICT`。

### P2-2 `dispatch` 把 `work.level >= L1` 当作写权限，`authorizationRef` 为空也能建写 Run

- 位置：`orchestrator.ts:901-917`（写/环境 scope 时只检查 `grantsModificationAuthority(work.level)`）、`:1303-1311`（`requiresExplicitAuthorization` 仅 L3，L1/L2 允许 `authorizationRef === undefined` 直接返回）、`packages/domain/src/routing.ts:322-324`。
- 真实复现：令一个 `level='L2'`、`authorizationRef` 为空的 Work（授权表 0 行）经 Chief Run 调 `dispatchProfessional`，spec `scope={writePaths:['src/anything'],operations:['edit','write']}`：
  - `L2-WITHOUT-AUTH dispatch -> {"ok":true,"runId":"...","frozenAuth":null,"effectiveScope":{"readPaths":[],"writePaths":["src/anything"],"operations":["edit","write"],...}}`
  - `L2-WITHOUT-AUTH grants -> 0`
- 可达性：**当前 T2 生产路径不可达**——`assessWithin`（`orchestrator.ts:672-717`）对 L1+ 的写 scope 强制要求派生或复用授权，`messages.ts:180-205` 在建 Work 时同步绑定 `authorizationRef`；我用 v4 探针确认 `level='none'` 时 `assess()` 自身也会被 `orchestrator.ts:458-459` 拒绝。
- 残余风险：不变量「写权限来自 Authorization 行」目前只由 `work.level` 间接保证。任何未来把 `work.level` 提高而忘记绑定授权（或授权被外部删除）的路径都会直接变成写 Run。建议把 L1/L2 的**写**情形与 L3 同等对待：`declaresWorkspaceWrite(scope)` 时 `authorizationRef` 缺失即 `NOT_AUTHORIZED`。

### P2-3 每个角色都注册全部三个控制工具，超出 `execution.md` §7 的角色工具面

- `control-client.ts:201-330` 的 `controlTools()` 无 `role` 参数，无条件返回 `[assessment_submit, agent_dispatch, stage_yield]`；`apps/runner/src/attempt.ts:143-173` 对任何角色都把这 3 个工具追加进 `customTools`，而 `attempt.ts:62-69` 的注释声称「It decides which control tools are registered」。
- 契约：`execution.md:53`「Chief有assessment_submit/agent_dispatch/decision_request；专业角色有stage_yield/request_dispatch」。
- 真实复现（端点 + handler，角色越权调用全部被拒，故**无权限提升**）：
  - `PRO assessment.submit -> 401 {"code":"NOT_AUTHORIZED","message":"backend may not call a Chief-only control method"}`
  - `PRO agent.dispatch -> 401 {"code":"NOT_AUTHORIZED","message":"Run ... is not a Chief Run"}`
  - `CHIEF stage.submit -> 400 {"code":"VALIDATION_ERROR","message":"a Chief Run submits an assessment, not a stage result"}`
  - `CHIEF bad workId -> 401 NOT_AUTHORIZED`（`requireChiefRun` 的 workId 绑定生效）
- 裁决：安全性由端点兜住，但把专业 Run 本不该持有的 Chief 工具暴露给模型，扩大了提示注入/误用的表面。应在 `controlTools`/`attempt.ts` 按 `role==='chief'` 只注册 `assessment_submit`+`agent_dispatch`，否则只注册 `stage_yield`。
- 附带：`apps/runner/test/control-client.test.ts:130`「registers the documented role tools」是**名字夸大**的断言——它没有传 `role`，只是断言三个工具恒在，等于把上述偏差写成契约。

### P2-4 Q1=B 下没有任何 Core 侧「用户确实下了执行指令」的判据（需登记残差）

- `ensureDerivedAuthorization`（`orchestrator.ts:828-856`）只看 `payload.scope.writePaths` 非空 + `sourceRef` 存在，就按**模型评估**写授权；授权的 `goal` 取自模型 payload（`:850`），来源指向 Work 的 `sourceRef`（`control-handler.ts:105-111`），全过程不检查该消息是否是一条执行指令（`routeMessage` 的 `explicitAuthorization` 未被参考）。
- 契约冲突点：`AC-004`「Given 用户仅询问能否优化；When Chief发现改进点；Then 可调查并建议，**未授权不启动交付**」；`PRODUCT.md:63`「沉默不产生授权」。在 Q1=B（`plan.md` D1b）下这些语义完全由 Chief 模型的分类承担。
- 缓解事实（已核对，故不升级为 P1）：T2 里 Chief 的 prompt 由 Core 用 `work.goal` 构造、并明示无工具（`prepare-run.ts:50-59`），Chief 不会读仓库内容，因此不存在「仓库内容注入→伪造交付评估」的通路；风险只来自用户自己的措辞被模型误判。
- 建议：① 把该残差登记进 WP-12 残差表并关联 AC-004；② 授权行至少记录评估自身的 `reason`（现仅存 `goal`），使「谁授权、依据什么」可审计；③ T3 工具桥落地前不要把派生授权接到真实文件写。

---

## 非阻塞发现（P3）

1. **超限 body 返回 500 而非 400/413**：`control-http.ts:167-177` 抛普通 `Error`，`:287-296` 把非 `ProtocolError` 一律映射成 `500 INTERNAL_ERROR`。真实复现：`oversized body -> {"status":500,"body":{"error":{"code":"INTERNAL_ERROR","message":"the control endpoint failed"}}}`（`maxBodyBytes:2048`）。不泄露栈（已确认返回体只有固定文案，栈只进日志），但状态码/错误码不符合 `protocol.md` §7。
2. **body 层未知字段被静默忽略**：三个分支只取 `workId/assessment/spec/result/operationId`，其余字段不校验。真实复现：`unknown body field -> {"status":200,"accepted":true,...}`。`protocol.md:11` 要求未知字段 `VALIDATION_ERROR`。内部通道，影响低。
3. **`expectedVersion` 未实现**：`protocol.md:115` 要求 assessment/dispatch 以 Work、stage 以 Run 为版本目标；`control-http.ts` 不读该字段，`control-handler.ts:270` 也不给 `StageGate.submit` 传 `expectedVersion`（`stage.ts:160-166` 的支持形同虚设）。内部通道因此没有乐观并发。
4. **`parseDraft` 的 workId 校验是死代码**：`orchestrator.ts:743-755` 先注入 `workId: chief.workId` 再解析，`:756-765` 的 `draft.workId !== chief.workId` 永不成立。真实复现：spec 里塞 `workId=其它 Work + profileRevision=999999` → `SPOOF workId+rev -> {"ok":true,"runWorkId":<Chief 的 Work>,"frozenRev":2000000,"currentRev":2000000}`（Run 落在 Chief 的 Work，revision 被 Core 覆盖）。行为安全，但报错文案与守卫应删除或改成「显式拒绝」。
5. **`assessAndDispatch` 无生产调用方**：`orchestrator.ts:589-612` 只在 `orchestrator.test.ts` 使用；生产走 `assessWithDerivation` + 独立 `dispatchProfessional`（`control-handler.ts:214/249`）。单事务语义已由探针验证（见下），但计划口径与在用路径不一致，建议明确保留或删除。
6. **测试缺口（按“若行为被破坏该用例是否失败”逐一判断）**：
   - 已有用例中，`control-http.test.ts` 的「无 capability/未知 token/attempt 终态/epoch 不匹配/终态 Run 撤销」与 `orchestrator.test.ts:2207` 的「zero residue」是**变异可杀**的（删掉对应分支即失败）。
   - 缺负例：专业角色能力调 `assessment.submit`/`agent.dispatch`（我用探针补了）、Chief Run 调 `stage.submit`（同上）、跨项目 capability（我用两个 endpoint 复现为 `401 the capability is not valid`）、同 `operationId` 重放、超限 body、非法 JSON（非法 JSON 已由我复现 400，但套件未断言）。
   - `orchestrator.test.ts:2060-2061` 只断言派生授权「不含 bash/network」，是弱断言；应断言精确操作集合（`['read','edit','write']`），集成测试 `assessment-dispatch.integration.test.ts:406` 已做精确断言。
   - 「injects the profile revision instead of trusting the draft」（`orchestrator.test.ts:2070`）用的是**类型上就不可能带 revision** 的 draft，等于靠类型而非靠行为；应像 `SPOOF` 探针那样在 wire 上塞 `profileRevision: 999999` 再断言被覆盖。
7. **`~` 路径只由派生守卫兜住**：`repoPathSchema`（`packages/contracts/src/primitives.ts:67-81`）接受 `~`，`isProjectRelativePath`（`orchestrator.ts:339-344`）才拒绝；`/etc/passwd`、`src/../etc` 在 schema 层即被拒。三条都经真实端点/`assessWithDerivation` 复现为 `VALIDATION_ERROR`/`NOT_AUTHORIZED` 且不落授权行，符合预期；此处仅记录守卫分层。

---

## G1 Gateway 凭证解析（独立章节，按父代理要求）

### G1.1 复现与诊断裁决：**结论成立，但病因描述需修正**

**复现（已执行，真实输出）**：构建生产同构的 Gateway——`SecretStore` 内注册 `provider:<id>`（audience=`gateway`）、Provider 配置带 `secretRef`、`secrets: gatewaySecretResolver(secrets, ctx)` 且 `ctx` 为 `execution.ts` 同构的可变上下文：

```
G1 availability(chief) grants=[] -> {"ok":false,"code":"CONFIG_INVALID","reason":"secret provider:018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e71 is not available"}
G1 availability with Grant in DB but ctx.grants=[] -> {"ok":false,...same...}
G1 after authorize() -> {"ok":true,"resolution":{...,"revision":2000000}}
G1 tool audience same ref -> {"ok":false,"code":"NOT_AUTHORIZED","reason":"secret provider:... belongs to the gateway channel, not tool"}
G1 secrets.has -> true
```

`ModelGateway.availability` 失败被 `orchestrator.ts:968-977` 包装为 `PROVIDER_UNAVAILABLE`，`protocol.ts:1775-1779` 的 `queueChiefAssessment` 捕获后只记日志、返回 null → **`message.send` 接受消息但不排 Chief Run**。与父代理观察到的 `role chief has no usable model: secret provider:<id> is not available` 完全一致。

**病因修正（逐点核对代码）**：父代理说「`gatewaySecretResolver` 闭包的是 `execution.ts:208` 的默认 context，`grants: []`」——不准确。`execution.ts:213` 传入的是**同一个可变对象**，`:94-111` 的 `authorize()` 就地改写它，闭包能看到更新（上面第三条输出即为证）。真正的两个断点是：

1. **`availability()`/`testConnection()` 在没有任何 Run、也没有 `authorize()` 的时点解析凭证**：`execution.ts:235-244` 的 `authorize` 只挂在 Gateway 代理的请求路径上（`gateway-http.ts:320` 先 authorize，`:331` 再 `complete`），而 `message.send`→`currentProfileRevision`/`dispatch` 走的是 `model-gateway.ts:92-106`，那时 `ctx.grants` 还是空（来源 `execution.ts:57-86` 的初值）。故即便 DB 里已有匹配 Grant，准入检查仍失败（上面第二条输出）。
2. **没有任何生产路径会铸造 `secret` Grant**：`SecretStore.admit`（`secrets.ts:386-402`）要求 `evaluateGrant` 放行 `secret` 操作；唯一铸造入口 `GrantService.issue`（`grants.ts:456`/`:536`）在 `apps/**` 中**从未被构造或调用**（`permission.request/respond` 在 `protocol.ts` 也没有 handler），而 `provider.upsert`（`protocol.ts:3011-3055`）只写 `SecretStore`/`SecretRepository`（`:3030-3033`）并**不建 Grant**。所以 `complete()`（`model-gateway.ts:140`）在真实安装里同样解析不到值——`attempt.integration.test.ts:182`、`provider-config.integration.test.ts:121-123`、`assessment-dispatch.integration.test.ts:283` 全都注入了忽略 Grant 的 stub resolver（`provider-config` 甚至写的是 `(ref) => secrets.has(ref) ? 'gateway-visible' : undefined`），**生产线从未被测**。

**旁证**：live 演练不用 `execution.ts` 的闭包——`scripts/lib/live-harness.mjs:310-336` 自建 `secretContext` 并在 resolver 里用 `activeGrant` 手工填 `grants`，所以「live 能过」证明不了生产路径可用，与父代理判断一致。

**一致性**：`secretRegistered`（`protocol.ts:3167-3178`）只做 `secrets.has(ref)`，故 `provider.upsert`/`config.get` 报 `secretConfigured: true`，而 `availability`/`testConnection` 失败——同一事实两套口径，修复后必须统一。

### G1.2 对拟定修法的裁决：**方向可用，但当前表述不够窄且漏掉真正的失败点——需按下面收窄后才接受**

拟定修法原文是「把该 Run 冻结配置快照里的 Provider `secretRef` 登记为该次 gateway audience 的可解析集合」。问题：**G1 的第一个失败发生在“还没有 Run”的 `availability()` 上**，冻结快照尚不存在，所以该修法单独实施后 `message.send` 仍排不出 Chief Run。

**必须改为三层，且都在 Core，不动 `SecretStore`/`evaluateGrant` 的既有策略**：

1. **`availability(role, runParams)`（`model-gateway.ts:99-104`）不再解析值，只校验注册存在性**（`secrets.has(ref)`）。准入本来就只需要「有凭证可用」，值只在真正调用时用；这样 `secretConfigured`、`available`、`config.get` 三处口径自然一致。
2. **`complete(run, ...)`（`model-gateway.ts:139-146`）只授权本次解析的那一个 ref**，且该 ref 必须来自 `frozen.provider.secretRef`（`ConfigStore.freeze` 写入的不可变快照），实现上给 `SecretAccessContext` 增加只在 `audience==='gateway'` 生效的「本次允许 ref」集合，每次调用按 Run 事实重设；`scopeAllows`（`secrets.ts:426-447`）的 audience/purposes/roles 收窄必须保留。
3. **`testConnection(providerId, modelId)`（`model-gateway.ts:197-199`）单独用一个仅为“被探测 Provider 的那个 `secretRef`”授权的 context**；`provider.test` 已是安装级方法，ref 来自 `config.provider(providerId)`，不接受模型输入。

**必须同时满足的前置/安全条件**：

- **冻结快照不可被模型影响**：`ProfileLayer` 含 `providerId`/`modelId`（`config.ts:59`、`config.ts:375-377` 的 `['run', runParams]` 是最强层），而 `DispatchInput.runParams`（`orchestrator.ts:159`）在文档里要求「必须来自用户授权」但**没有任何校验**。T2 现状安全：`control-handler`/`message` 路径都不传 `runParams`，`dispatchProfessional` 甚至没有该参数。因此这是**硬前置**：若将来任何调用方把模型可影响的 `runParams` 传进来，本修法就等价于「Run 自选凭证」。必须在 `dispatch` 里拒绝非授权来源的 `runParams`，或在解析时只信任冻结快照/`config.resolve(role)`（而非 `runParams`）产生的 ref。
- **不得顺带放宽 `tool`**：新增允许集合必须 `context.audience === 'gateway'` 才生效；`tool` 仍走 `evaluateGrant`。上面探针已确认同一 ref 在 `tool` audience 被 `belongs to the gateway channel, not tool` 拒绝，回归必须保持。
- **跨角色**：允许集合必须来自**该 Run 自己的**冻结快照；同一项目不同角色若配置了不同 Provider，Run A 不得解析 Run B 的 ref。共享同一 Provider 是安装者选择，不算泄露。
- **`secretConfigured`/`config.get`/`provider.test` 一致**：修复后 `has` 为真即 `secretConfigured:true`，且 `provider.test` 对已注册凭证必须真能连通（现在因 Gate 恒失败）。

**必须补的负例测试**（每条都要能杀掉对应分支）：

1. 已注册但**不在本次 Run 冻结快照/角色解析结果**里的 ref → `NOT_AUTHORIZED`/不可解析；
2. 未注册 ref → 仍 `unavailable`（保留 `model-gateway.test.ts:159-172` 的 R18-05 语义，但要补「注册后 `availability.ok===true`」的正例）；
3. `tool` audience 无 Grant → 拒绝（`secrets.test.ts` 已有，须在修复后仍绿）；
4. 跨角色复用：Chief Run 的 context 不能解析只有 backend 冻结 Profile 指向的 ref；
5. `provider.test` 不吃调用方传入的 ref；
6. 生产同构回归：用 `execution.ts` 的真实 `SecretContext`+`gatewaySecretResolver`（不是 stub）跑通「`provider.upsert`→`message.send` 入队 Chief Run→`complete` 取到值」。

---

## 已验证的声明（我本人执行并有真实输出）

命令与结果（`export PATH="$HOME/.local/bin:$PATH"`）：

1. `pnpm typecheck` → **exit 0**。
2. `pnpm exec vitest run --project unit packages/core/test/control-http.test.ts packages/core/test/orchestrator.test.ts` → `Test Files 2 passed (2) / Tests 67 passed (67)`，exit 0。
3. `pnpm exec vitest run --project unit apps/runner/test/control-client.test.ts` → `6 passed (6)`，exit 0。
4. `pnpm exec vitest run --project integration apps/daemon/test/assessment-dispatch.integration.test.ts` → `3 passed (3)`（含 happy path、out-of-envelope 零残留、两次不合规 contract_violation），exit 0。
5. 端口检查：复查开始时 `lsof -iTCP:4318` 与 `:4317` 均无监听（exit 1），未出现先前那次 flake；本轮全部探针自建随机端口。

行为探针（`node --input-type=module -`，真实 SQLite + 真实 `Orchestrator`/`AttemptCapabilityStore`/`StageGate`/`createControlEndpoint`/`createControlHandlers`）：

- **事务原子性（P1 相关修复确实有效）**：派生授权成功后让 dispatch 在 `requireTask` 处失败 → `ATOMICITY failure= {"code":"NOT_FOUND",...}`、`ATOMICITY auth delta= 0`、`ATOMICITY runs delta= 0`、`ATOMICITY work= {"level":"none","auth":null,...}`。即「授权行先落库、spec 后失败」被外层事务回滚。
- **派生封套（Q1=B）**：`bash`/`network`/`deploy` → `NOT_AUTHORIZED: a derived authorization never grants environment operations`；`networkTargets` → `never grants network targets`；`artifact_write`（既非环境也非白名单）→ `does not cover`；`~/.ssh` → `VALIDATION_ERROR: must stay inside the project root`；`/etc/passwd`、`src/../etc` → `assessment.submit is invalid`（`repoPathSchema`）；`git` → 允许，生成的授权为 `{"ops":["git","read","edit","write"],"wp":["src/theme"]}`。
- **不可越权**：已记录 `src/theme` 授权后，新评估写 `src/theme+src/other` → `NOT_AUTHORIZED: does not cover the declared scope`；用显式 grant（`src/theme`, `read/edit`）同样拒绝放宽，授权行数保持 1；dispatch spec 夹带 `bash` → `NOT_AUTHORIZED`，专业 Run 数 0。
- **身份绑定**：跨项目 capability → `401 {"code":"NOT_AUTHORIZED","message":"the capability is not valid"}`；`PRO assessment.submit/agent.dispatch` 与 `CHIEF stage.submit`、`CHIEF 错误 workId` 全部按角色/Work 拒绝（真实 HTTP 200/401/400 见 P2-3）。
- **HTTP 健壮性**：非法 JSON → `400 VALIDATION_ERROR: the request body is not JSON`；超限 body → `500 INTERNAL_ERROR`（不泄栈）；无 capability → `401`；未知 body 字段 → `200`（见 P3-1/2）。
- **重放**：`dispatchProfessional` 同 spec 两次 → 2 个不同 Run；`stage.submit` 同 result 两次 → 2 行 `stage_result`（P2-1）。
- **P2-2**：L2 且无授权的 Work 可 dispatch 出 `frozenAuth: null` 的写 Run（当前生产路径不可达）。
- **G1**：`availability` 失败 / 有 Grant 但 context 空仍失败 / `authorize()` 后成功 / `tool` 拒绝 / `has=true`，输出见 G1.1。
- **能力不进 argv、凭证 0600**：`runner-spawn.ts:206-210` 注释与 `:181-203` 参数列表确认 argv 无 token；`runner-spawn.ts:86-113` 以 `mode:0o600` 写 catalog；`apps/runner/src/cli.ts:125-141` 从 catalog 读取；无日志打印过 token。

---

## 未验证 / 不确定

- **未跑全量套件**：只跑了上列 4 个定向文件；`pnpm test:unit|integration|test:e2e|test:live` 全量未执行。并发编辑 `apps/cli/**`、`scripts/**` 的改动未被我触碰或验证；若全量失败，请先归因到那两个目录的进行中改动。
- **G1 的端到端未做真实 daemon 演练**：我用生产同构的 Gateway 探针复现了 `availability` 失败，并按 `queueChiefAssessment` 的 catch 路径推断「消息接受但无 Chief Run」。未启动真实 daemon + HTTP `message.send` 观察该日志；这一环是代码推理而非执行。
- **`provider.test` 命令级行为**：`testConnection` 走同一 resolver 是读码确认，未执行 daemon 命令探针（上表 G1 探针验证的是 `ModelGateway.availability`，不是 `probeProvider` 事件）。
- **符号链接逃逸未验证**：T2 没有任何文件工具（`apps/runner/src/cli.ts:115` `BUILTIN_TOOLS=[]`，`prepare-run.ts:57` 明确「Tool use is not available」），派生授权只写入 `effectiveScope`、尚无运行期执行面，故符号链接逃逸在 T2 不可达，须由 T3 Broker 在 `open` 时做 realpath 校验（`execution.md:27`）。我未构造 symlink 用例（无可被执行面）。
- **`assess()` 公开 API 的 L2 无授权窗口**：P2-2 已用探针证明 `dispatch` 会放行，但当前无生产调用方；「未来某路径是否可达」无法穷举，故按 P2 而非 P1 报告。
- **未读** `T2-implementation.md`、开发者聊天、`.agentdev/work/WP-12/T1-*`（按指令只依据代码与正式文档）。
- **探针基于 dist**：`packages/*/dist` 构建时间 17:12 晚于源码最后修改（16:59/16:41），且关键函数逐条与源码对照一致；测试与 typecheck 则直跑源码。若随后有人改动源码而未重建 dist，本文的探针输出需重跑。
