# Review Report · devagent-marker-notice-ui-mode-20261005

独立审阅按 `docs/productnew/modules/delivery.md` D-05 与 skill 要求执行：审阅者使用独立上下文、只读、不读取开发者聊天与自评。

## Round 1 · 独立只读审阅（会话 MarkerUiReview）

```yaml
review:
  task: devagent-marker-notice-ui-mode-20261005
  reviewer_session: MarkerUiReview   # 独立上下文，只读
  scope: "spikes/harness/{host-ui,question-tool,pi-env}.ts、spikes/{pi-01,pi-08}.ts、docs/technicalnew 两处契约、任务记录"
  reproduced:
    - "cd devagent && npx tsc --noEmit  # exit 0"
    - "cd devagent && npm run spikes    # 47/47"
  findings:
    - severity: blocking
      location: devagent/spikes/harness/host-ui.ts:34（类定义）经 pi-08 的 bindExtensions 使用
      evidence: "SDK 的 wrapUIPromptContext 用 `{...ui, select, confirm, input, editor, custom}` 包装；对象展开只复制自有可枚举属性，类实例的原型方法全部丢失 —— 探针实测 ctx.ui.notify 为 undefined，工具因此抛『notify is not a function』"
      impact: "任何调用 ctx.ui.notify 的扩展/工具会抛 TypeError；适配器声称的『TUI-only 显式失败』在包装后也不成立"
      remediation: "适配器实现为普通对象（工厂返回字面量），并新增断言覆盖 notify 存活、TUI-only 报错、theme 缺失"
      status: fixed
    - severity: overclaim
      location: devagent/spikes/pi-08-host-ui.ts、implementation.md、plan.md
      evidence: "计划与文档仍以『不可交互模式下拿不到 UI』为验证目标；D 段标题与契约的『与 mode 无关』措辞均超出可运行证据"
      remediation: "改为 D1（不绑定→不可交互）+ D2（绑定+print→可交互）；契约措辞收窄为『绑定适配器是开关』并引固定版本实现；计划/记录同步修正"
      status: fixed
    - severity: overclaim
      location: devagent/spikes/harness/question-tool.ts:128
      evidence: "idleWhileWaiting 在工具入口采样，却在检查里当作『等待期间仍被占用』"
      remediation: "改名为 idleAtToolEntry；新增 C2：适配器保持 25ms，在答案 pending 窗口内采样 session.isIdle"
      status: fixed
  result: failed   # 1 项 blocking
```

## Round 2 · 修复后独立复审（会话 MarkerUiReview2）

```yaml
review:
  task: devagent-marker-notice-ui-mode-20261005
  reviewer_session: MarkerUiReview2   # 新独立上下文，只读
  regression: none
  round1_verified:
    - "blocking：已改为工厂返回普通对象；同一真实绑定路径下对比——类实例 notify=undefined 且工具报错，普通对象 notify=ok，PI-08 F 仅对后者通过"
    - "等待期间采样：C2 在 pending 窗口内采样（先轮询到请求已记录，再读 isIdle），谓词可失败"
    - "契约措辞：与两个实测组合 + 固定版本 hasUI() 一致，未过度断言其它 mode"
    - "计划与记录：已按修正后表述更新；历史旧名有标注"
  findings:
    - severity: non-blocking
      location: devagent/spikes/harness/question-tool.ts:62
      evidence: "结构化字段仍名为 idleWhileWaiting（语义为工具入口采样）"
      remediation: "改名 idleAtToolEntry（三处赋值同步）"
      status: fixed
    - severity: non-blocking
      location: .agentdev/work/devagent-bootstrap-p0-20261004/test.md:26
      evidence: "旧名 custom(agentdev.input) 缺少就地标注"
      remediation: "就地加『旧名』标注"
      status: fixed
  overclaims: []
  result: passed
```

### 增量复核（会话 MarkerUiReview2，2026-10-05 追加）

对上述两项修复与 settlement 引用措辞的增量复核：**passed**，无新发现、无回归（tsc exit 0、vitest 21/21、spikes 47/47）；`grep -rn idleWhileWaiting devagent/` 无匹配。