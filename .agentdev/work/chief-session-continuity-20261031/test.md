# Test · 主管会话连续性

```yaml
test:
  task: chief-session-continuity-20261031
  environment: macOS darwin 25.5.0 arm64; Node v24.8.0; TypeScript 5.9.2; vitest 3.2.7 (devagent/node_modules); commands run from devagent/
  runs:
    - command: npx tsc --noEmit
      result: passed
      exit_code: 0
      evidence: no diagnostics
    - command: npx vitest run test/store.test.ts test/server-write.test.ts test/step-wake.test.ts test/step-wake-e2e.test.ts
      result: passed
      exit_code: 0
      evidence: 4 files, 52 tests passed (store 28, server-write 17, step-wake 6, step-wake-e2e 1)
    - command: npx vitest run
      result: passed
      exit_code: 0
      evidence: 49 files, 484 tests passed, 18.73s
    - command: npx vitest run --exclude 'test/step-wake*'
      result: passed
      exit_code: 0
      evidence: 47 files, 477 tests passed (the pre-change suite size, confirming no removed coverage)
  not_covered:
    - area: 真实 aisuangua state.db 副本的队列场景
      reason: 独立测试未重放；开发阶段做过一次副本探针
      disposition: pending
    - area: 浏览器“排队中回显 → 投递”与唤醒回合渲染
      reason: 未运行 playwright / test:browser
      disposition: pending
    - area: 暂停→恢复、queued 停止、恢复确认后的唤醒
      reason: 该触发点尚未实现（review F1）
      disposition: pending
    - area: 引导消息在真实 workbench 中跑完（修复 1）
      reason: 只有 claim 级用例；e2e 只覆盖唤醒
      disposition: pending
    - area: 看门狗/等待超时的真实发生路径
      reason: e2e 用“启动时主管无输入”模拟回合已结束
      disposition: pending
    - area: ask/interaction.respond 与两条改动的隔离
      reason: 代码阅读确认（独立表、不入 session_inputs）；未单独跑交互用例
      disposition: pending
  result: passed
```

## 额外核对

- `test/step-wake-e2e.test.ts` 使用真实 `startWorkbench` + stub 模型 + 第二个 SQLite 连接观察；两个新测试文件里没有 `vi.`/mock/spyOn，`step-wake.ts` 未被替换。
- 文档声明与实测一致：6 条 step-wake 用例、真实进程 e2e、49 文件 484 用例、`tsc` 通过；queue 条目的“47 文件 477 用例”由 `--exclude` 复现。
- 唯一文案差异：e2e 未断言 `notice-step-` 前缀（id 前缀在 `step-wake.ts:43` 与单测中覆盖）。
- 范围：tracked 变更与声明一致；`devagent/.start.sh.swp`、`devagent/start.sh`、`devagent/state.db` 为无关未跟踪文件，未被触碰或提交。
