# Plan · devagent-marker-notice-ui-mode-20261005

状态：Approved（用户指令：「先把上面两条建议实现，然后验证」）
流程：Plan → 实施 → 独立 Review → 真实运行验证 → 结算与提交。

```yaml
plan:
  task: devagent-marker-notice-ui-mode-20261005
  goal: >
    落实两项已确认建议：(1) 把「输入书签」与「恢复通知」拆成两个不同名称，
    使按名称扫描书签不需要再判断记录种类；(2) 明确声明浏览器宿主属于可交互宿主，
    并用真实运行验证确认/选择/输入能往返。
  in_scope:
    - 设计文档：拆名 + 声明可交互模式（docs/technicalnew 两处）
    - 试验基座：书签/通知名称常量拆分，新增宿主 UI 适配器
    - PI-01：书签与通知按名称各自可定位，扫描书签不会命中间通知
    - 新增 PI-08 试验：宿主 UI 适配器 + 移植版 question 工具，确认/选择/输入/取消往返
    - 验证「可交互模式」是必需的：不可交互模式下同样的交互拿不到 UI
  out_of_scope:
    - WAL 落库、经主管通道转发、重启后 stale（属产品侧 M5/S7 实现，P4/P5 阶段）
    - 真实模型凭证（仍无）；本包继续用 stub 端点
    - 不改产品行为、验收或首版范围
  steps:
    - id: S1
      change: docs/technicalnew/runtime-contract.md：标记/通知拆名；bindExtensions 显式声明可交互模式
      paths: [docs/technicalnew/runtime-contract.md]
      verify: [人工核对两处名称与 M3 一致]
    - id: S2
      change: docs/technicalnew/messaging-and-collaboration.md：恢复通知名称与绑定模式补充
      paths: [docs/technicalnew/messaging-and-collaboration.md]
      verify: [交叉核对两文件名称一致]
    - id: S3
      change: 基座常量拆分 + 宿主 UI 适配器（spikes/harness）
      paths: [devagent/spikes/harness/pi-env.ts, devagent/spikes/harness/host-ui.ts]
      verify: [npm run typecheck]
    - id: S4
      change: PI-01 改用两名称并新增「按名称扫描」断言
      paths: [devagent/spikes/pi-01-input-correlation.ts]
      verify: [node spikes/pi-01-input-correlation.ts 全通过]
    - id: S5
      change: 新增 PI-08 试验（question 移植 + 宿主适配器 + 模式差异）
      paths: [devagent/spikes/pi-08-host-ui.ts]
      verify: [node spikes/pi-08-host-ui.ts 全通过]
  review_focus:
    - 拆名是否真的让「找书签」不再需要判断条目种类
    - 交互往返是否用了真实 SDK ctx.ui 通道（不是自造回调）
    - 「交互由什么开关」的结论是否由可失败对照断言支撑（原假设「mode 是开关」已被实测否定，见 plan_deviation）
    - 宿主适配器在被 SDK 包装（对象展开）后是否仍保留全部成员
    - 是否引入与 M5 契约冲突的第二套交互状态
  test_plan:
    - npm run typecheck（退出码 0）
    - npm run spikes（含新增 pi-08，退出码 0，无 FAIL）
    - 独立运行 pi-08，观察请求/答复往返、等待期间会话状态、以及 UI 表面完整性（notify 存活 / TUI-only 报错 / theme 缺失）
  risks:
    - SDK 的 uiContext 接口面较大，适配器需要完整实现；只补首版真正用到的行为，其余显式空实现
  rollback: 还原文档两处名称与绑定行；删除 pi-08 与适配器；PI-01 常量还原
  approval: approved-by-user-instruction
```