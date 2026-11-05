# Plan · devagent-p2-runtime-20261005

状态：Approved（用户指令：「下一步开始 P2」）；依赖 P1 已结算（commit 084417a）。
依据：运行契约 R3～R6、R2 输入状态；架构 A4/A5；角色与上下文装配 G4；实现检查 I2 的 P2。

```yaml
plan:
  task: devagent-p2-runtime-20261005
  goal: >
    把 P1 的存储内核接到真实 Pi 会话上：为每个逻辑会话建立/恢复独立 Pi 实例，
    按其显式 cwd/模型/凭证/工具装配执行被认领的输入，观察实际停稳，
    保存边界（书签与根输入条目）与结果，并按事实区分 completed/failed/stopped/interrupted。
  in_scope:
    - 存储扩展（schema v2）：session_inputs 增加 checkpoint 与 effectiveConfig，供投递/收尾写入真实边界
    - 有效配置解析：角色覆盖 → 项目默认 → 服务器默认；不可用即阻断（保留 queued），不静默回退
    - Pi 实例注册表：一逻辑会话一实例；显式 cwd/agentDir/modelRuntime/piFile/工具；dispose 可核对
    - 执行链路：可用性预检 → 认领 → 追加输入书签 → 投递 → 等实际停稳 → 按消息级事实分类 → 写 checkpoint/终态
    - 停止路径：停止意图已记录时中止并写 stopped；无法确认边界时写 interrupted
  out_of_scope:
    - 领域工具与角色提示词注入（P3）
    - HTTP/SSE 与浏览器 UI（P4）
    - file_saves 跨存储顺序与结算（P5）；本轮只写 Pi 侧边界与输入终态
  decisions:
    - 复用 P0 取证：`prompt()` resolve ≠ 成功（失败看 assistant stopReason/errorMessage）；书签用自定义条目
      `agentdev.input-marker`；按「marker 子树内第一个 role=user」定位根输入条目；不触碰全局 cwd/env
    - 输入内容本轮只支持文本（payload 的 text 部分拼接）；非文本内容如实拒绝并记录为偏差
    - 凭证继续走 Pi 原生解析（env / models.json / auth.json 路径由服务器配置给出），
      与真实模型检查（checks/real-model.ts）共用同一配置来源
  steps:
    - id: P2-a
      change: 存储 schema v2：checkpoint/effectiveConfig 列 + 迁移 + finishInput 接受 checkpoint
      verify: [v1→v2 迁移测试；checkpoint 往返；旧库升级后仍可认领]
    - id: P2-b
      change: 有效配置解析（纯函数）+ 可用性判定
      verify: [角色覆盖优先；项目默认次之；不可用返回 MODEL_UNAVAILABLE 且不认领]
    - id: P2-c
      change: Pi 实例注册表（创建/复用/dispose，一会话一实例）
      verify: [同一会话复用同一实例；dispose 后计数归零；显式 cwd 生效]
    - id: P2-d
      change: 执行链路与终态分类（成功/模型错误/停止/未确认边界）
      verify: [stub 端点四类路径真实运行；checkpoint 写真实条目 ID]
  review_focus:
    - 是否出现第二套重试/重放；是否改写原生消息字段
    - 终态是否只由消息级事实 + 磁盘核对推导（而不是 prompt() 返回）
    - 配置不可用时是否真的不认领、不静默换模型
  test_plan:
    - npm run typecheck / npm test / npm run spikes（不得回归）
    - 四类路径的运行时集成测试（stub 端点）+ 一次真实模型端到端（复用 devagent/config/model.json）
  document_impact:
    - 若发现契约字段不足（checkpoint/effectiveConfig 已有定义），先记录再上报，不自行改契约
  risks:
    - Pi 实例泄漏：测试断言实例数与会话数一致
    - 真实调用可能慢/不稳定：真实模型检查不作为 npm test 的一部分
  rollback: 删除 src/runtime 与相关测试；存储 v2 迁移保留（向后兼容 ADD COLUMN）
  approval: approved-by-user-instruction
```