# Plan · devagent-p6-acceptance-20261010

## 1. 事实（证据）

- 实施检查 `docs/technicalnew/implementation-checks.md:33`：P6 = 「配置说明、备份恢复、实际模型与浏览器走通产品流程」，依赖前述适用包。
- 已交付包：`devagent-bootstrap-p0`、`marker-notice-ui-mode`、`p1-store-dispatcher`、`p2-runtime`、`p3-tools`、`real-model`、`prompt-english`、`p4-webui`。**P5（恢复与结算）没有工作包**。
- 能力地图（只读侦察，`P6CapabilityMap`）已核实：
  - 已有：角色提示装配与注入（`src/runtime/prompt-assembly.ts`）、七角色提示文件（`docs/technicalnew/prompts/`）、角色工具白名单、主管 Task 工具（createTask/updateTask/endTask/`task`）、同步委派等待（`delegation-tools.ts:228-244` + `runner.ts:575-610`）、Plan 落盘 `.dev/work/<taskId>/plan.md`（`plan-store.ts`）、需求记录严格 front matter（`requirement-store.ts`，SCHEMA_VERSION=2）、agent_report、question 工具 → 交互桥 → 浏览器、input.stop、task.control（暂停/继续/取消）、session.recovery.inspect/resolve、八视图外壳。
  - 只有服务端、**没有浏览器入口**：`session.input.stop`、`project.rebind`、`session.cleanup`；index.html 的 STOP/PAUSE 控制台按钮无处理函数。
  - 未实现：**会话交接（handover）**；主管提示词引用的 `task.reconcile` 不存在。
  - 部分：需求归档/合并只有 status + sourceRequirementIds（无专门 op）；知识结算只有 settler 角色 + settlement 报告（无专门知识写入工具）；项目入口文件只校验存在性，内容由主管提供。
  - 模型接线：服务端只认 `AGENTDEV_MODEL_PROVIDER`/`AGENTDEV_MODEL_ID` 两个环境变量；凭证必须是 Pi 的 `<agentDir>/models.json` + `auth.json`（agentDir 默认 = 数据目录），**服务端没有模型配置文件加载器**；`config/model.json` 仅供检查脚本使用。模型不可用 → 输入留队并 `blocked_config MODEL_UNAVAILABLE`，不回落。
- 前次会话证据：`node checks/runner-real-model.ts` 4/4（deepseek-flash，真实模型调用 question 工具并收到答复）。
- `docs/technicalnew/validation.md`：P6 完整产品验收尚未执行。

## 2. 判决（范围与取舍）

- P6 以产品验收 `docs/productnew/acceptance.md` 的 AC-01～AC-35 为唯一判据，逐项给结论；文档检查不记通过。
- 本轮**能真实执行**的（有模型凭证、有浏览器、服务端能力已核实）：AC-01、AC-02、AC-03、AC-05、AC-06、AC-07、AC-10、AC-11、AC-12、AC-13、AC-14、AC-17、AC-19、AC-20、AC-21、AC-27、AC-32（只读侧）。其余按实测结果记 failed / not_run（环境阻断或能力缺失），**不降级**。
- 已知会 failed/not_run 的项先给依据（能力地图），实测仍要跑一次以确认，不靠推断下结论。
- 交付材料（配置说明、备份恢复）属 P6 第一项，必须补齐并实跑。

## 3. 切片

```yaml
- id: P6-a 交付材料与备份恢复
  change: devagent/README.md（启动、访问凭证、模型凭证放置、数据目录内容、备份与恢复步骤、端口/环境变量表）；实测备份→清空→恢复→重启后记录与会话仍在
  verify: 按 README 逐字执行一遍能起来；备份恢复后同一项目/会话/需求/任务可读
- id: P6-b 环境与夹具
  change: 三项目 A（有代码+已有文档）/B/N（无 Git），真实模型凭证写入数据目录 models.json/auth.json，真实服务进程 + 真实 Chromium
  verify: 服务起来后 /api/v1/rpc auth.login 200；模型可用性检查有结果（不是 MODEL_UNAVAILABLE）
- id: P6-c 无模型与登录（AC-02、AC-27、AC-01）
  change: 未登录/登出后操作被拒；无模型时读既有资料；同目录二次打开回同一项目；不同目录分开
  verify: 每项留请求/响应与界面证据
- id: P6-d 讨论与需求（真实模型）（AC-06、AC-07、AC-03）
  change: 浏览器里用真实模型自由讨论、整理需求、明确保存；入口确认与差异展示
  verify: 需求文件与列表真的出现；讨论未隐式建需求/任务
- id: P6-e 实现全链路（AC-10/11/12/13/14/17/19）
  change: 选定实施需求启动 Task；总体 Plan 落盘；阶段推进；暂停/继续/取消；轻量改动
  verify: 每个可观察结果留证据（文件、报告、界面）
- id: P6-f 交互与断线（AC-20、AC-21、AC-05）
  change: 子会话提问在主管页面答复并继续；关浏览器/断线后重连；同项目两段主管会话
  verify: 请求-答复-恢复原调用；重连后历史与待答复仍在
- id: P6-g 结算与登记
  change: test.md 逐 AC 记录通过/失败/未执行/环境阻断与证据；implementation.md 记录实际改动
  verify: 每条结论可指到命令输出或截图
- id: P6-h 独立审阅
  change: 独立上下文复核场景结论与证据真实性，列出过度声明
  verify: review.md 结论；阻断项回修
```

## 4. 明确不做

- 不改产品需求与设计文档（除非验收发现设计与实现冲突，按流程另立需求处理）。
- 不为通过验收而降低判据：能力缺失的项如实记 failed/not_run。
- 不补做 P5（恢复与结算）的实现工作；本轮只取证其缺失对验收的影响。

## 5. 风险

- 真实模型成本与耗时：全链路（Task 多阶段）会消耗较多 token 且耗时长；按切片推进，失败即登记，不刷分。
- 模型行为不稳定：同一场景可能因模型自由发挥而不可复现；结论按实际运行记录，不推断。
- 浏览器驱动：用 Playwright 与真实 Chromium 走用户路径，截图与网络记录留证。
