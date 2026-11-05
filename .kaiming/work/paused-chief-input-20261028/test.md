# Test · paused-chief-input-20261028

独立测试（新上下文；不读开发对话；只改 /tmp 下的临时 harness）。

```yaml
test:
  task: paused-chief-input-20261028
  environment: >
    darwin 25.5.0 arm64；Node v24.8.0；cwd devagent；真实服务由 startWorkbench 在进程内启动
    （mkdtemp dataDir、随机端口、127.0.0.1），模型为仓库 SSE stub（spikes/harness/pi-env.ts），
    provider 写入 <dataDir>/models.json、auth.json=[]。任务断言读取 stub.requests[].body.tools[]，
    即模型真正收到的工具表；task(op=get) 结果从本次运行的 Pi JSONL 中读取。
  runs:
    - command: 真实 HTTP：model-task 场景（模型在 turn 1 自行 task(op=create)，pause 后用真实 revision 控制）
      result: passed
      exit_code: 0
      evidence: >
        turn 1 queued→processing→completed；pause {"status":"paused","revision":2}；
        turn 2（暂停）queued→processing→completed；turn 3 resume 后 completed。
        按当轮唯一用户文本匹配请求（stub 把 tool-call 与其续turn记为两条请求，同轮两条工具表一致）：
        运行轮 [read,grep,find,ls,bash,task,requirement,project,question,web_search,web_fetch,browser]
        暂停轮 [read,grep,find,ls,task,question,web_search,web_fetch,browser]
        恢复轮 [...,bash,requirement,project]。
        task(op=get) 暂停时返回 context.writeHold=paused 与说明、nextActions 含 command=resume；
        resume 后同一调用无 context 字段。
    - command: 真实 HTTP：pre-existing-task 场景（Task 在会话首轮运行前已创建并暂停）
      result: passed
      exit_code: 0
      evidence: 首个输入即 queued→processing→completed；首个请求已是窄工具表（无 write/edit/bash/requirement/project），task(op=get) 返回 writeHold=paused。
    - command: 真实服务 + 直接 Store 门闩探针：A2 成员、A4a cancelled、A4b cancelling
      result: passed
      exit_code: 0
      evidence: >
        成员 → controlled/TASK_CONTROLLED 且保持 queued；cancelled → claim none，迟到输入被
        TASK_ENDED 关闭；cancelling → chief 与成员均 controlled。
    - command: 真实崩溃：成员输入在跑时进程 exit，重新启动同一 dataDir 后复核 A3
      result: passed
      exit_code: 0
      evidence: >
        启动日志 "1 input(s) from an earlier run are now interrupted…"；暂停该 Task 后
        claimNextInput → blocked/RECOVERY_REQUIRED（恢复门闩优先于暂停例外）。
    - command: npx vitest run（cwd devagent）
      result: passed
      exit_code: 0
      evidence: 42 文件 444 用例全绿。
    - command: npm run typecheck
      result: passed
      exit_code: 0
      evidence: 无诊断。
    - command: 反证：git worktree HEAD + 覆盖四个测试文件（去掉修复）
      result: passed
      exit_code: 0
      evidence: >
        tool-sets 1 failed/11 passed、store 1 failed/24 passed、task-tools 1 failed/18 passed、
        runtime 3 failed/44 passed；失败项正是本轮新增用例，既有用例全通过。
  not_covered:
    - area: 端到端中的 Pi 实例身份（新建 vs 复用）
      reason: startWorkbench 不暴露 registry；实例新建由单测“gives the paused turn its own instance…”覆盖
      disposition: accepted
    - area: 成员/cancelled/cancelling 的输入经真实 HTTP 提交
      reason: session.input.submit 只接受 chief；这些输入经同一 state.db 的第二个 Store 认领，与 worker 同一门闩
      disposition: accepted
    - area: 重启后仍为 interrupted 的 chief 输入
      reason: 宿主启动扫描会关闭 chief 的中断输入（既有 host-recovery 行为），因此 A3 用成员输入验证
      disposition: accepted
  result: passed
```

## 前一轮测试的更正

第一轮独立测试报告“暂停轮复用了运行轮实例、仍带 bash”。复现后确认是**请求索引错位**：
stub 把一轮里的 tool-call 请求和续跑请求都记入 `requests[]`，按序号取第 2 条实际拿到的是
turn 1 的第二个请求。按当轮唯一用户文本匹配请求后，暂停轮请求不含 bash，resume 轮恢复；
这也解释了当时看到的“滞后一轮”。因此没有为该假象增加防御代码。
