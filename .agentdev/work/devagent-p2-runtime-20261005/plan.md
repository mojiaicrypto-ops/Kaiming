# Plan · devagent-p2-runtime-20261005

状态：Draft（待 P1 结算后启动；用户已授权按步骤推进）
依据：运行契约（R3～R6、R2 输入状态）、架构（A4/A5）、角色与上下文装配（G4）、实现检查（I2 的 P2）。

```yaml
plan:
  task: devagent-p2-runtime-20261005
  goal: >
    把 P1 的存储内核接到真实 Pi 会话上：为每个逻辑会话建立/恢复独立 Pi 实例，
    按其显式 cwd/模型/凭证/工具/上下文装配执行被认领的输入，观察实际停稳，
    保存边界与结果，并按事实区分 completed/failed/stopped/interrupted。
    本包仍不含 HTTP/UI（P4）。
  in_scope:
    - SessionRegistry：一会话一个 Pi 实例；显式 cwd/model/credentialRef/tools/piFile；不改变全局 cwd/env
    - 配置解析：角色覆盖 → 项目默认 → 服务器默认；不可用即保留阻断，不静默回退
    - 上下文装配：项目入口（AGENTS.md / .dev INDEX / PROJECT）+ 当前 Task/Plan/授权 + 本次输入与依据路径
    - 投递：先写 deliveryStartedAt、追加输入书签标记，再调用 Pi；输入状态与 generation 一致
    - 收尾：核对 agent_settled、错误/取消、宿主正式结果与指定历史边界，按事实写终态与 checkpoint
    - 停止：工具内 ctx.abort；外层 await session.abort 等实际空闲；未确认的边界保持 interrupted
    - 模型不可用/目录不可用：输入保持 queued 并记录原因（不吞错、不伪造执行）
  out_of_scope:
    - 领域工具（createTask/updateTask/…）与角色提示词注入（P3）
    - HTTP/SSE 与浏览器 UI（P4）
    - WAL 交互表与结算跨存储顺序（P3/P5）
  decisions:
    - 复用 P0 已取证的结论：prompt() resolve ≠ 成功（失败看 assistant stopReason/errorMessage）；
      书签必须是自定义条目且按名称定位；每个会话显式配置、绝不触碰全局 cwd/env
    - 本包仅用 stub 端点做集成验证；真实模型行为仍标注未取证
  steps:
    - id: P2-a
      change: SessionRegistry + 会话创建/恢复（指定 piFile、history 判定按磁盘）
      verify: [新建会话无文件→有内容后出现文件；open 指定文件恢复同一历史]
    - id: P2-b
      change: 配置解析与有效配置记录（含不可用阻断）
      verify: [角色覆盖命中；模型不可用时输入保持 queued 且原因可读]
    - id: P2-c
      change: 执行链路：认领→装配→书签→投递→观察→收尾
      verify: [一次成功输入写 completed + checkpoint（marker/root 条目 ID）；一次 stopReason=error 写 failed]
    - id: P2-d
      change: 停止路径与未知边界
      verify: [停止请求后实际停稳写 stopped；无法确认边界写 interrupted 并阻断后续]
  review_focus:
    - 是否出现第二套重试/重放；是否改写原生消息字段
    - 配置不可用时是否静默回退模型
    - 终态判定是否只依赖消息级事实 + 磁盘核对，而不是 prompt() 返回
  test_plan:
    - npm run typecheck / npm test / npm run spikes（不得回归）
    - 新增运行时集成检查（stub 端点）：成功、模型失败、停止、恢复四类路径的真实运行证据
  document_impact:
    - 若发现契约字段不足（例如 checkpoint 需要新字段），先记录并上报，不自行改契约
  risks:
    - Pi 实例生命周期管理容易泄漏（dispose 遗漏）；测试须断言进程内实例数与会话数一致
  rollback: 删除 runtime 模块与检查；P1 存储内核不受影响
  approval: pending-p1-settlement
```