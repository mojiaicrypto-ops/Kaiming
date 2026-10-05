# Test Report · devagent-p2-runtime-20261005

```yaml
test:
  task: devagent-p2-runtime-20261005
  environment:
    runtime: node v24.8.0 / vitest 3.2.7 / node:sqlite；@earendil-works/pi-coding-agent 1.0.0
    model: 集成测试用本地 stub 端点；真实模型检查用 devagent/config/model.json（deepseek-flash）
  runs:
    - command: cd devagent && npx tsc --noEmit
      result: passed
      exit_code: 0
      evidence: "无输出（src/、spikes/、test/、checks/ 全部通过 strict 检查）"
    - command: cd devagent && npm test
      result: passed
      exit_code: 0
      evidence: "4 个测试文件、46 项通过（store 17、dispatcher 6、model-config 5、runtime 18）"
    - command: cd devagent && npm run spikes
      result: passed
      exit_code: 0
      evidence: "47/47（PI-01 18、PI-02 5、PI-05 5、PI-07 9、PI-08 10），无回归"
    - command: cd devagent && node checks/real-model.ts
      result: passed
      exit_code: 0
      evidence: "4/4（真实模型宿主问答往返）"
    - command: cd devagent && node checks/runner-real-model.ts
      result: passed
      exit_code: 0
      evidence: "4/4：真实模型输入被完成并记录真实边界（elapsedMs≈1.1s）、checkpoint 含 marker/根条目、effectiveConfig 无凭证、claim=1/serverEpoch=1"
  key_evidence:
    - "成功路径：completed + checkpoint（inputMarkerId/inputEntryId/piFile）+ effectiveConfig；实例数=1，dispose 后=0"
    - "复用路径：同一会话第二个输入复用同一 Pi 实例（对象同一性断言）"
    - "失败路径：端点持续 500 → failed(MODEL_ERROR)，且失败的运行仍保留已落地的 checkpoint"
    - "停止路径（宿主工具）：noteAbort + ctx.abort → stopped；未登记时同一 abort 如实记为 failed（不猜、不美化）"
    - "未确认边界：首次 Pi 写入即失败（文件只读）→ interrupted(HOST_SAVE_FAILED)，输入不会滞留在 processing"
    - "配置不可用：provider 不在目录中 → blocked_config，输入保持 queued，且未创建任何 Pi 实例"
    - "恢复阻断：上一代次遗留的 processing 被扫描为 interrupted 后，runNext 返回 blocked(RECOVERY_REQUIRED)"
    - "存储迁移：v1 库（缺两列）打开后升到 v2，已有记录保留且可继续认领"
    - "真实模型端到端：完整执行链路在真实 provider 上跑通（不只是 stub）"
    - "运行中停止（并发用例）：工具在运行中阻塞，stop 请求到达（status=processing/stopRequested=true）后中止并落库为 stopped（不再卡在 processing、也不再误判模型错误）"
    - "历史连续性：配置从 stub-1 换到 stub-2 后实例被重建，但 piFile 不变且文件里同时保留两次输入的内容"
    - "边界读回校验：单测覆盖「文件含标记/根条目/叶子=真」「缺条目=假」「文件缺失=假」「文件被截断=假」；运行中把会话文件设为不可读 → interrupted"
    - "目录不可用：删除工作目录后 runNext 返回 blocked_project，输入保持 queued 且未创建实例"
    - "会话无法准备：绑定到不存在的历史文件 → interrupted(HISTORY_UNAVAILABLE)，不会把输入留在 processing"
    - "构造中到达停止（确定性用例）：create 被挂住并最终抛错，期间发出停止请求（processing/stopRequested=true）→ 终态仍被写入（interrupted，不是滞留在 processing）"
    - "绑定历史消失：两次同配置运行之间删除绑定的历史文件 → interrupted(HISTORY_UNAVAILABLE) 且陈旧实例被销毁（实例数 0）"
    - "边界结构校验：正例通过；反例（marker 的 inputId/摘要不符、根条目非后代 user 消息、叶子不可达、缺会话头、截断 JSON、文件缺失）全部为假"
  not_covered:
    - area: "HTTP/SSE 与浏览器 UI（P4）"
      reason: "本包不实现接入层"
      disposition: pending
    - area: "file_saves 跨存储顺序、结算与 Git 保存（P5）"
      reason: "本包只写 Pi 侧边界与输入终态"
      disposition: pending
    - area: "Task 级暂停/取消与真实 Task/领域工具（P3 起）"
      reason: "依赖领域工具与 Task 表"
      disposition: pending
    - area: "非文本输入内容（图片等）"
      reason: "本轮明确只支持文本，非文本判为 failed(INVALID_ARGUMENT)"
      disposition: pending
    - area: "S3 的『控制允许』前置条件（Task 暂停/取消时的认领拦截）"
      reason: "依赖 Task 表与领域工具（P3）；本包只强制存储层的运行中/未核实中断规则，已在代码注释与实施记录中写明"
      disposition: pending
    - area: "PI-09 并发容量、超时与多会话调度组合"
      reason: "调度器已有轮转测试，但并发容量与超时属 PI-09"
      disposition: pending
    - area: "真实模型长期多轮行为与产品验收（I4/P6）"
      reason: "需要逐项场景验证与浏览器"
      disposition: pending
  result: passed
```