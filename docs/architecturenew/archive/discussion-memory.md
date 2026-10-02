# 归档讨论材料

本文件仅保留讨论记录，不属于产品规格，不参与默认读取，不作为规则或实现依据。

记录日期：2026-10-02。状态：非正式讨论记录，持续推进中。

本目录保存架构重设计的讨论、初步建议与待决问题，不属于正式实现依据，不代表架构已批准或功能已实现。现行产品、架构、规则与验收仍以 `../INDEX.md` 列出的正式文档为准。本记录不授权代码重写，也不修改现有门禁或验收。

产品设计使用独立的产品文档入口。本文件中的建议和比较仅作为讨论存档。

## 1. 用户方向与约束

- 产品底层目标保持：主管协作、项目知识、专业角色独立执行、研发交付与知识沉淀。
- 用户进一步明确：产品要优化并实现 `agentdev-project-workflow` skill 的全部功能，不能将能力缩减为一份主管提示词或部分交付阶段。
- 用户担心旧实现的历史补丁、职责重复和跨层调用继续累积，希望重新设计运行底座，而非不断包装旧运行核心。
- 参考 Pi Durable 的持久执行与恢复设计；当前不直接采用 Durable，不完整复制其通用框架。
- 继续基于现有 Pi 实现核心功能；Pi 1.0 升级等功能完备后再考虑。
- 优先保持面向 UI 的公开协议与事件流，减少 UI 修改。兼容目标包括载荷、ID、版本、错误、幂等、水位与重连语义，不仅是方法和事件名称。
- 工具执行希望统一抽象为本地、远程或沙箱环境；第一版不在大范围门禁和沙箱基础设施上投入过多。
- 按层讨论架构，逐步形成完整方案。暂不将讨论内容提升为正式契约。

## 2. 调研事实与概念澄清

- Pi Durable v1.0.0 复用 `pi-ai ^1.0.0` 的模型访问层，以 Chord 配合自有存储、任务与状态机制实现持久运行；不是在 `pi-coding-agent` Session 外增加恢复包装。
- Durable 自行实现 GenerationTask、ToolTask 和调度，不依赖 coding-agent 或 agent-core 的 Agent 循环。切换 Durable 需要迁移运行接口，不能默认继承 coding-agent 的全部能力。
- Durable 用一个 Harness 管理多个 Conversation，每个 Conversation 有自己的模型、工具、指令和执行目录；不要求每会话独立 Runner 进程。
- DSH 通过 Agent registry 管理多个 Agent/Session，以 Workspace registry 组织项目目录与 Session 归属。其插件体系不作为本项目整体复制目标。
- 事件保存、执行意图和 checkpoint 职责不同：事件描述已发生事实；执行意图记录准备执行的操作；checkpoint 记录恢复位置；结果/回执证明副作用是否完成。

来源：

- [Durable v1.0.0 依赖](https://github.com/earendil-works/pi/blob/v1.0.0/packages/durable/package.json)
- [Durable 运行说明](https://github.com/earendil-works/pi/blob/v1.0.0/packages/durable/README.md)
- [DSH Agent](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent/README.md)
- [DSH Workspace](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/workspace/workspace/README.md)

DSH 来源为本次调研时的 master 文档，未固定提交；以上调研不构成采用第三方组件的决定。

## 3. 第一层：运行结构初步建议

用户已基本认可下面的运行结构，认为能够减少进程间调度、简化跨进程访问。具体接口与实现仍未冻结：

```text
Browser / CLI
      ↓
AgentDev Server
 ├ 公开协议、认证、订阅与事件投影
 ├ 项目目录与产品状态
 ├ 工作协调
 └ Agent Runtime
     ├ Session A：Chief，项目 1
     ├ Session B：Backend，项目 1 的 Task worktree
     ├ Session C：Review，项目 1 的冻结输入
     └ Session D：Chief，项目 2
              ↓
       Tool Execution
         ├ Local
         ├ Remote
         └ Sandbox
```

### 初步职责边界

- Server 是业务状态的唯一权威，浏览器和 CLI 不独立维护业务事实。
- Project 是业务归属、配置、知识与交付记录的边界，不必为每项目复制数据库、Mailbox、EventHub、Supervisor 等整套运行基础设施。
- 统一 Runtime 管理多个独立 Pi Session。模型循环可以先在服务器进程内运行，多会话及独立上下文本身不要求多进程。
- 独立 Agent Runner 是可选实现，暂不作为第一版必选项。此前“必须保留独立 Runner”的建议已被后续讨论修正。
- Shell/工具进程仍可独立启动；同进程 Session 不提供 OS 级隔离。多个 Session 必须显式传递 cwd，不使用全局 `process.chdir()` 切换项目。
- ExecutionEnvironment 决定文件与进程操作在哪里执行，Tool 定义操作语义、输入输出、重放策略和结果核对。
- 第一版建议先完成 Local 环境；Remote/Sandbox 先确定接口，不同时建设全部实现。
- 分派、stage_yield、产物提交等领域工具调用产品服务，不强行转换成 Shell 或远程文件操作。
- Web/BFF 可以与 daemon 同进程，也可以独立部署；内部网络连接不是公开协议兼容的必要条件。
- Model Gateway、Artifact Service 可以保留独立职责，具体部署与接线下一层讨论。

### 持久化与恢复初步方向

- 使用 SQLite 事务与 WAL 承担存储原子性，不预设自研 WAL 引擎。
- Pi JSONL 继续承载模型会话历史；运行状态、检查点、操作意图和结果需要明确权威及跨存储核对方式。
- 同一逻辑工具操作跨 Attempt 保持稳定身份；不能把“没有返回结果”认定为“没有副作用”。
- Remote 断线不等于工具失败，取消请求已发送不等于执行已停止。
- 服务器进程崩溃可能同时中断多个 Session，必须通过持久状态恢复；是否采用 worker 隔离留待决定。

## 4. 第二层起点：Project 与 Session 绑定

当前建议采用显式 `projectId`，不靠 cwd 推导项目归属，尚未冻结 Schema：

```ts
{
  id: 'S2',
  projectId: 'P1',
  runId: 'R2',
  role: 'backend',
  environmentRef: 'local',
  cwd: '/worktrees/P1/T1'
}
```

- Project → Work → Run → Pi Session 的项目归属由系统继承，专业 Agent 不自行指定其他项目。
- cwd 是执行位置，可为项目根、Task worktree、冻结副本或远程目录；不等于业务身份。
- UI Conversation 属于一个 Project，可关联多次 Work；Pi Session 服务一个专业 Run，可跨恢复 Attempt 延续。两种会话不直接等同。
- 每个专业 Run 默认新建独立 Session。Review/Test 不继承开发 transcript。
- 恢复按保存的 Session/Run/环境绑定进行，不搜索整个 Project 或 Work 的“最近 Session”。
- 项目重定位应更新环境映射并保持业务身份；稳定 Project ID 和远程路径映射的具体方案未定。

后续协议讨论提出“Session 是持续的 Agent 上下文，Run 是一次执行”的备选解释；它与上面“一 Run 一 Session”的初步建议尚未统一。Session 是否跨 Run 延续、Chief 与专业角色是否采用不同生命周期，仍需讨论，不能据此修改现行数据契约。

## 5. 重写边界与简化原则

以下为初步建议，不是实现 Plan：

- 保留产品目标、公开协议与事件语义、验证真实行为的测试场景。
- 新运行核心不通过调用旧 Supervisor/恢复服务维持执行；旧代码作为行为证据和算法参考。
- 领域规则、Git 集成、知识与产物服务逐项审查复用，不能仅因旧工程杂乱而全部丢弃。
- 公开协议兼容不要求保留旧 protocol.ts 的业务实现；新协议层应只解析、调用和投影。
- 每个状态只有一个写入权威，避免工作协调、运行管理、协议层各自推进同一状态。
- 上下文可简化为阶段输入装配及必要引用校验；保留独立会话构造。装配失败不静默降级为另一种执行方式。
- 批准、独立验证、完成判定和工具权限的具体保留范围仍需讨论，不能将“减少门禁”直接解释成全部取消。
- 同一项目同一时刻只有一个执行权威。旧运行现场是否迁移、是否允许结束活动任务后切换，尚未决定。

## 6. 下一步待讨论

1. 确认第一版进程模型：同进程 Pi Session、工具子进程、可选 worker 的边界。
2. 确定 Project/Conversation/Work/Run/Attempt/Session 的最小关系、身份与状态权威。
3. 确定执行存储、Pi JSONL、checkpoint 与操作回执之间的一致性边界。
4. 确定 Tool 与 ExecutionEnvironment 的最小接口，以及本地取消和结果核对语义。
5. 确定第一版上下文、权限、交付 Gate 的必要范围及明确删除项。
6. 冻结公开协议兼容清单、事件接续语义和验证场景。
7. 确定旧数据/历史产物/活动运行的迁移范围，再形成正式架构和实施 Plan。

推进方式：每讨论一层，更新本目录对应记录，区分用户决定、架构建议与未知。明确批准后再更新正式文档；不让讨论记录或新代码自行替代现行契约。

## 7. 协议层讨论入口

见 [协议与业务交互讨论](protocol-discussion.md)：记录基础消息层与 Runtime/协作调度的边界，以及聊天式业务按钮、统一回调和可扩展业务命令的初步方案。用户认可此方向并要求保存为讨论记忆；字段、命名和状态枚举仍是示例，不是正式协议。

## 8. 主管规则与执行方式

见 [主管规则与加载方式讨论稿](chief-rules-draft.md)：包含具体启动提示词、按需规则的触发、Pi Session 接入位置和任务工具连接建议。

后续讨论已收敛为 Agent 优先：主管自主选择上下文并派发，子 Agent 自行读取规则与依据；需求文档是需求事实源，Server 保存本机执行现场；用户 action 可直接投递给主管执行。早期记录中“按钮解析后由业务服务包办执行”的建议不再作为当前推荐。新稿为未冻结的建议，不授权代码或正式文档变更。

## 9. 完整 skill 功能覆盖

见 [完整工作流 skill 的产品化覆盖目标](workflow-skill-coverage.md)：本轮已读取 skill 全部参考规则与模板，列出 C01–C20 能力及 Agent/文档/程序的职责。后续以完整能力覆盖核对方案；该清单不是现有代码完成状态，外部 skill 不替代本仓库正式契约。
