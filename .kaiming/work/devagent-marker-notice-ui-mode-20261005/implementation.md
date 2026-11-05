# Implementation Summary · devagent-marker-notice-ui-mode-20261005

```yaml
implementation:
  task: devagent-marker-notice-ui-mode-20261005
  changed:
    - path: docs/technicalnew/runtime-contract.md
      purpose: 书签/通知拆成两个名称；补入「必须绑定 UI 适配器」的实测结论
    - path: docs/technicalnew/messaging-and-collaboration.md
      purpose: 恢复通知改用 agentdev.input-notice；M5 绑定段落改写为实测结论
    - path: devagent/spikes/harness/pi-env.ts
      purpose: 常量拆分为 agentdev.input-marker（书签）与 agentdev.input-notice（通知）
    - path: devagent/spikes/harness/host-ui.ts
      purpose: 宿主 UI 适配器：完整实现 SDK 的 ExtensionUIContext（确认/选择/输入为真实实现并记录请求；纯 TUI 方法显式失败或空实现）
    - path: devagent/spikes/harness/question-tool.ts
      purpose: 官方 question 工具的浏览器移植版：参数运行时校验、走通用交互、模型可见结果带宿主 interactionId
    - path: devagent/spikes/pi-01-input-correlation.ts
      purpose: 通知使用自己的名称；新增「按名称扫描书签不会命中通知」
    - path: devagent/spikes/pi-08-host-ui.ts
      purpose: 新增试验：交互往返（确认/选择/取消/输入）、interactionId 回传、等待期间会话被占用、无适配器时不可交互
    - path: devagent/tsconfig.json
      purpose: lib 提到 ES2024（使用 Promise.withResolvers）
    - path: devagent/package.json
      purpose: spikes 脚本加入 pi-08
  behavior:
    - 全部 5 个试验真实运行：47/47 断言（PI-01 18、PI-02 5、PI-05 5、PI-07 9、PI-08 10），退出码 0，临时目录零残留
    - 书签与恢复通知按名称即可区分：按书签名扫描得到 1 条且不含通知
    - 浏览器宿主把确认/选择/输入接到自己的适配器；模型可见的工具结果带 interactionId、hasUI 与真实答复
  review_round_1:
    - 独立只读审阅判定 failed：1 项 blocking + 5 项 overclaim
    - blocking（真实缺陷）：SDK 的 bindExtensions 用对象展开包装 uiContext，**类实例的原型方法在包装后丢失**（实测 ctx.ui.notify 变 undefined）。已把适配器改为工厂返回的普通对象，并新增 PI-08 F 断言（notify 存活且真的记录、TUI-only 调用报出适配器自己的错误、theme 缺失为实测事实）
    - 其余修正：等待期间会话状态的采样改为在答案pending 时实测（新增 C2，用 25ms 保持窗口）；契约措辞收窄为「绑定适配器是开关」（两个组合 + 源码 hasUI() 实现）；本计划与测试文档改为修正后的表述
    - 第二轮独立审阅（新上下文）结果见 review.md
  plan_deviation:
    - 计划里写的验证目标是「不可交互模式下拿不到 UI」。实测推翻：mode 字符串不控制交互可用性，**是否绑定 UI 适配器才是开关**。据此把契约改成「必须绑定适配器，mode 只按真实身份声明」，并把对照断言改为 D1（不绑定→不可交互）+ D2（绑定但 mode="print"→仍可交互）
    - 计划假设「适配器用类实现即可完整满足 ExtensionUIContext」。实测推翻：SDK 用对象展开包装，类实例的原型成员会丢失；改为普通对象（工厂）
  findings_for_implementation:
    - "官方 question 工具在非 TUI 模式直接报错（examples/extensions/question.ts 的 ctx.mode !== 'tui' 守卫与 ctx.ui.custom 全屏组件）；浏览器移植必须改成通用交互方法，不能照抄该守卫"
    - "**宿主 UI 适配器必须是普通对象**：bindExtensions 用 `{...ui, select, confirm, input, editor, custom}` 包装，类实例的原型方法会在包装后丢失（实测 notify → undefined，会导致任何调用 notify 的扩展/工具抛 TypeError）"
    - "交互进行时会话保持被占用：工具入口与答案 pending 期间都实测 idle=false；交互不额外产生模型调用（8 次 prompt = 8 次模型请求）"
    - "SDK 的 ExtensionUIContext 面较大：产品侧适配器需要完整实现；TUI-only 方法调用时应显式失败，纯展示类方法可空实现；theme 这类值型成员无法真实提供（展开会求值 getter），显式给 undefined 并在测试中实测该事实"
  document_impact:
    - docs/technicalnew 两处（R4 行、M5 段）已按实测更新；PI-08 相关验收补充建议记在本任务 settlement.md（随本任务提交）
  risks_remaining:
    - 产品侧尚未实现：请求落库（WAL）、经主管通道呈现、重启后原 Promise 丢失转 stale、子请求不解除父委派等待——这些属于 P4/P5，本包只取证 SDK 交互管道本身
```