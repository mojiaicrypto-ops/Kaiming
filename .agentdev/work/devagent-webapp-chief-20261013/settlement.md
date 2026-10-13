# Settlement Record · devagent-webapp-chief-20261013

任务: devagent/webapp-chief 会话视图（新 UI 层 v1）+ 服务端活快照。计划见 plan.md；实施事实见 implementation.md。

## stable_facts
- 新 UI 层决策落地：`devagent/webapp/`（React 19.2 + Vite 7 + TS 5.9），构建产物 `web-static/`（已 gitignore），由同一服务器同源托管于 `/app/`；旧壳继续服务 `/`（双壳并存，可回退）。
- 服务端唯一功能性改动：`session.stream.prepare` 快照经 `currentHistory` 优先取活 Pi 实例内存条目（`live-snapshot.ts` 投影，inputId 关联与文件读一致），空闲会话回退 `readPiHistory`——消除"快照落后于直播 → resync 丢在飞消息"的根因（旧壳实测缺陷）。
- 移植件（MIT，`webapp/src/ported/PORTED.md` 登记）：agegr/pi-web 高亮预算队列；versot `@versot/pi-web@0.1.11` npm tarball（GitHub 不可公开访问，已核实并如实标注）的 slot/滚动语义（语义级重实现，非逐行拷贝）。
- 独立复核（WebappReview1）9 项发现全部处置：CSRF 写路径、STOP 无效、答复卡不消失、跨会话快照竞态、自动跟随观察对象错误、孤儿 key 去重、死代码/调试钩子清理、PORTED 署名纠正、/app 路由测试补齐。

## verification
- `npm test`（含新 live-snapshot 3 项、stream harness 2 项、slot 4 项、/app 路由 2 项）: **23 文件 235/235**。
- `npx playwright test`（旧壳 8 场景回归）: **8 passed**。
- `webapp`: tsc 0、vitest 4/4、build 成功。
- 真实模型 + Chromium 实测（项目 aisuangua、会话 s-217e25bd5235）:
  - 历史: 30+ 消息节点渲染、顺序正确、刷新后完整。
  - 流式: 消息提交 → 流式增长（hljs token 流中 0→14→40）→ 完成后保留（节点 29→30 稳定）。
  - **代次变化场景（旧壳丢消息处）**: 流式进行中 `config.save` 触发运行时重载 → 快照合并后内容延续同一句子、无丢失（节点 34 稳定、`通道与留痕` 完整出现）。
  - 修复后写路径实测: 第八问提交 → 模型回答出现在转录（CSRF 修复生效）。

## evidence_boundary（未执行/未覆盖）
- 子会话（createTaskSessions）端到端未见真实 Task 运行: TaskCard/MemberDrawer 的数据路径已实现并接 `task.get`/子会话流，但没有"真实 createTaskSessions Task"取证（需要真实多会话运行，成本高；成员状态实时性靠 3s 轮询是已知缺口，见 plan §7）。
- `session.messages.list` 分页懒加载（`chat-lazy-load` 移植件）尚未接入视图（快照窗口 100 条已够当前体量）。
- 轻量交互卡实测仅覆盖旧壳时代的 select 样例；confirm/input 形态未在新壳实测。
- 视觉验收: mock 1:1 选择器保真不适用于新壳（架构决策变更，Plan §3 已声明）；视觉质量未做像素对照。

## archived
- `.agentdev/work/devagent-webapp-chief-20261013/`
## no_change
- `docs/productnew/**`（产品需求不变；D-06 任务详情仍由旧壳 Runs 视图承载，新壳 Task 卡是其 chat 内投影）
- `oldcode/`、`docs/old/`、`docs/architecturenew/`、`webui/`
## completion_gate: passed（边界如上如实登记）
