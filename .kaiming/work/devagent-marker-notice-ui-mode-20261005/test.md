# Test Report · devagent-marker-notice-ui-mode-20261005

```yaml
test:
  task: devagent-marker-notice-ui-mode-20261005
  environment:
    runtime: node v24.8.0 (darwin arm64)
    package: devagent@0.1.0（@earendil-works/pi-coding-agent 1.0.0 精确固定）
    scope: 写入仅限 os.tmpdir()/devagent-p0-*
  runs:
    - command: cd devagent && npx tsc --noEmit
      result: passed
      exit_code: 0
      evidence: "无输出；lib 提升到 ES2024 后 Promise.withResolvers 通过类型检查"
    - command: cd devagent && npm run spikes
      result: passed
      exit_code: 0
      evidence: "47/47 断言：PI-01 18/18、PI-02 5/5、PI-05 5/5、PI-07 9/9、PI-08 10/10"
    - command: ls -d "$TMPDIR"/devagent-p0-* | wc -l
      result: passed
      exit_code: 0
      evidence: "0 残留"
  key_evidence:
    - "PI-01: 恢复通知使用 agentdev.input-notice（custom_message）；按书签名 agentdev.input-marker 扫描只得到 1 条且不含通知 → 拆名后无需再判断条目种类"
    - "PI-08 E: question 工具恰好注册一次，激活列表=[question]"
    - "PI-08 A: 宿主适配器收到真实请求内容——confirm 的 message、select 的选项 [A,B]、input 的 placeholder 均与模型请求一致"
    - "PI-08 B: 选择返回所选值（answer=\"B\"）、取消返回 null（对应 undefined）、输入返回文本（answer=\"typed text\"）、确认返回 true"
    - "PI-08 A2: 模型可见结果带宿主 interactionId（q-1..q-4）与 hasUI=true"
    - "PI-08 C: 工具运行期间会话被占用（idleAtToolEntry=false）"
    - "PI-08 C2: 答案 pending 期间（适配器保持 25ms）实测 session.isIdle=false → 等待交互时会话确实被占用，而不只是工具入口时刻"
    - "PI-08 F: SDK 包装后的 ctx.ui 仍保留 notify（4 次调用全部记录）、TUI-only 调用报出适配器自己的错误（getAllThemes(): the browser host has no Pi TUI surface）、theme 实测为 undefined → 捕获『类实例被对象展开后原型方法丢失』这一类缺陷"
    - "PI-08 D1: 宿主不绑定适配器时 ctx.hasUI=false，工具如实返回 UI not available，宿主零请求"
    - "PI-08 D2: 绑定适配器后即使声明 mode=\"print\" 也能交互 → 交互开关是绑定适配器（两个组合实测，与固定版本 hasUI() 实现一致），mode 只按真实身份声明"
  not_covered:
    - area: "交互请求落库（WAL）、经主管协作通道呈现、重启后原 Promise 丢失转 stale、子请求不解除父委派等待"
      reason: "属产品侧 P4/P5 实现；本包只验证 SDK 交互管道与宿主适配器本身"
      disposition: pending
    - area: "真实模型行为（模型是否恰当地使用 question）"
      reason: "仍无模型凭证；本包用 stub 端点上固定触发工具调用"
      disposition: pending
  result: passed
```