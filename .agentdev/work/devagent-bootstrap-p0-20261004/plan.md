# Plan · devagent-bootstrap-p0-20261004

状态：Approved（用户指令：新工程放入独立目录、语言随 Pi SDK、整体规划由我定、按步骤开始开发）
角色：主管/开发（本会话）→ 独立 Review（独立上下文，只读）→ Test（真实执行）→ Settlement。

```yaml
plan:
  task: devagent-bootstrap-p0-20261004
  goal: >
    建立 devagent/ 新工程骨架；用真实固定版本 Pi SDK 取得 P0 门禁证据（PI-01/02/05/07），
    产出可核验的 SDK 能力勘察与试验记录，供后续 P1+ 依据。
  requirements: [I2-P0, I1-PI-01, I1-PI-02, I1-PI-05, I1-PI-07, R4, S4, A5]
  in_scope:
    - 新工程根目录 devagent/（package.json、tsconfig、精确依赖）与可运行的 spike 入口
    - 对照 R4/G2 清单勘察 Pi v1.0.0 实际 API 面，记录存在/缺失与差异
    - PI-01 输入关联：inputId ↔ custom entry marker ↔ 原生根条目；首次文件创建、压缩/分支、扩展拦截
    - PI-02 事件语义：原生重试、原生工具失败、message_end/agent_end/agent_settled 与磁盘边界；注入 JSONL 写失败
    - PI-05 保存失败与停止：宿主保存失败不得返回成功、ctx.abort 与外层等停稳
    - PI-07 多 cwd/多模型并行、模型不可用、角色工具/规则变化下的重建
    - 证据文件与工作记录归档在 .agentdev/work/devagent-bootstrap-p0-20261004/
  out_of_scope:
    - P1+ 业务实现（Store/Dispatcher/域工具/UI/恢复算法）：本任务不写业务框架
    - 读取或改动 oldcode/、docs/old/、docs/architecturenew/、webui/
    - 修改 docs/productnew、docs/technicalnew 契约（发现差异只记录，按 I5 处理）
    - 真实模型行为验证（I4）与产品验收（P6）：需要用户提供模型凭证后另行安排
  decisions:
    - 工程根：仓库根下 devagent/（独立单包，不接入已删除的旧 pnpm workspace）
    - 语言/运行时：TypeScript，Node >= 22.19（SDK engines；本机 v24.8.0），ESM
    - 依赖安装：npm（本机 11.6.0），SDK 精确固定 @earendil-works/pi-coding-agent@1.0.0
    - 试验代码：devagent/spikes/ 独立最小目录，一文件一试验，可直接 node 运行（Node 原生 TS 类型剥离）
    - 流程参数沿用仓库 AGENTS.md + docs/productnew/modules/delivery.md，不另建 skill onboarding 问卷（避免第二份契约冲突；如用户要求再补）
    - 证据边界：无模型凭证时，SDK 机制类试验使用本地 OpenAI 兼容 stub provider 走真实 SDK 请求/会话/事件路径，并明确标注"stub provider ≠ 真实模型行为"
  tasks:
    - id: S0
      owner: developer
      change: devagent/ 骨架：package.json、tsconfig.json、npm 安装固定版本 SDK、typecheck 通过
      paths: [devagent/package.json, devagent/tsconfig.json]
      verify: [npm --prefix devagent install, npm --prefix devagent run typecheck]
    - id: S1
      owner: developer
      change: SDK 能力勘察：对照 R4/G2 清点真实导出与类型（session/resourceLoader/customTools/executionMode/bindExtensions/appendCustomEntry/events/abort）
      paths: [.agentdev/work/devagent-bootstrap-p0-20261004/sdk-surface.md]
      verify: [node 脚本打印实际导出名，比对清单]
    - id: S2
      owner: developer
      change: PI-01 spike：inputId 关联标记 + 首次文件创建 + 压缩/分支 + 扩展拦截
      paths: [devagent/spikes/pi-01-input-correlation.ts]
      verify: [运行 spike，检查产出的 Pi JSONL 中 marker/root 条目对应]
    - id: S3
      owner: developer
      change: PI-02 spike：事件与磁盘边界；注入 JSONL 写失败不得被当作 completed
      paths: [devagent/spikes/pi-02-settle-semantics.ts]
      verify: [运行 spike，观察事件序列与失败注入结果]
    - id: S4
      owner: developer
      change: PI-05 spike：宿主保存失败 → 不返回成功、ctx.abort、外层 await 实际停稳
      paths: [devagent/spikes/pi-05-save-fail-abort.ts]
      verify: [运行 spike，观察 abort 后 settled 状态与错误事实]
    - id: S5
      owner: developer
      change: PI-07 spike：多 cwd/多模型并行、模型不可用、规则/工具变化后的冷恢复
      paths: [devagent/spikes/pi-07-multi-session.ts]
      verify: [运行 spike，确认不串 cwd/env、不默认回退模型]
    - id: S6
      owner: settler
      change: 汇总证据、独立 Review、Test、Settlement 与 git 提交
      paths: [.agentdev/work/devagent-bootstrap-p0-20261004/]
      verify: [git log 显示本次提交]
  review_focus:
    - 是否出现"按正文/数组位置匹配"代替 inputId 关联，或改写原生消息字段
    - 是否引入第二套重试/重放引擎（违反 R2/S7）
    - 证据是否为真实 SDK 执行（非假回调）；stub provider 是否被诚实标注
    - 依赖是否精确固定、路径是否越界写入项目源码
  test_plan:
    - npm --prefix devagent run typecheck（退出码 0）
    - 逐个运行 devagent/spikes/*.ts，记录命令、退出码、关键输出、生成文件
    - 独立复核产出 JSONL/日志与结论一致（不采信口头声明）
  document_impact:
    - 新增 .agentdev/work/devagent-bootstrap-p0-20261004/{sdk-surface,implementation,review,test,settlement}.md
    - docs/technicalnew/implementation-checks.md 若证据与 R4 不符，只上报差异，不自行改契约
  open_items:
    - 真实模型凭证缺失 → I4 与 P6 另议
    - Pi 1.0.0 与 1.0.2 的 API 差异（若 1.0.0 缺必需能力，按 I5 记录再决定）
  risks:
    - SDK API 与 R4 假设不符 → 记录失败试验 + 受影响契约 + 最小替代，不静默改协议
    - Node 类型剥离对 SDK 类型/装饰器支持不足 → 退回 tsc 构建或 tsx
    - 单例锁/状态目录误用真实用户数据 → 试验统一使用临时目录
  rollback: 删除 devagent/ 与本次新增工作记录目录，仓库其余文件不动（用户既有 oldcode/ 迁移与未提交删除保持原样）
  approval: approved-by-user-instruction
```

## 后续路线（引用，不复制）

P1 Store/Dispatcher → P2 Project/Runtime → P3 领域工具与协作 → P4 UI 消息适配 → P5 恢复与结算 → P6 安装与完整验收；依据 `docs/technicalnew/implementation-checks.md#i2`。每包独立 Plan 与独立 Review/Test。