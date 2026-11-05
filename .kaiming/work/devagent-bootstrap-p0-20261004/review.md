# Review Report · devagent-bootstrap-p0-20261004

独立审阅按 `docs/productnew/modules/delivery.md` D-05 与 skill 要求执行：审阅者使用独立上下文、只读、不读取开发者聊天与自评。

## Round 1 · 独立只读审阅（会话 P0SpikeReview）

```yaml
review:
  task: devagent-bootstrap-p0-20261004
  reviewer_session: P0SpikeReview    # 独立上下文，只读，未见开发聊天
  reviewer_model: 未单独指定（与开发者同一可用配置，独立性由会话与上下文隔离保证）
  context_snapshot: devagent/** + .agentdev/work/devagent-bootstrap-p0-20261004/{plan,sdk-surface,implementation,test}.md
  reproduced:
    - "cd devagent && npx tsc --noEmit  # exit 0"
    - "cd devagent && npm run spikes    # exit 0"
    - "ls -d $TMPDIR/devagent-p0-* | wc -l  # 0"
  findings:
    - severity: blocking
      location: devagent/spikes/pi-05-save-fail-abort.ts:104-105
      evidence: "check C 的谓词是 session.getActiveToolNames().length > 0（恒真），detail 里硬编码 idleReached=true"
      impact: "PI-05/S5 要求的『外层到达真实空闲边界』没有任何可失败的断言；abort/waitForIdle 失效也会 PASS"
      remediation: "改为断言 session.isIdle === true"
      status: fixed
    - severity: non-blocking
      location: devagent/spikes/pi-01-input-correlation.ts:108-111
      evidence: "『session file created after real message』只检查 getSessionFile() 返回非空字符串，而前一条检查已证明它在 prompt 前就非空"
      impact: "该断言不可失败，对首文件建立无证据价值"
      remediation: "断言 existsSync(fileAfterPrompt)"
      status: fixed
    - severity: non-blocking
      location: devagent/spikes/pi-02-settle-semantics.ts:126-128
      evidence: "D『memory-ahead-of-disk』只断言 memoryAfter > memoryBefore，磁盘侧仅出现在 detail 文本"
      impact: "即使第二回合真的落盘，该断言仍会通过，与 R4/S4 要求的『内存领先磁盘视为未保存』不符"
      remediation: "谓词纳入 linesAfter === linesBefore"
      status: fixed
    - severity: non-blocking
      location: .agentdev/work/devagent-bootstrap-p0-20261004/test.md:35-52
      evidence: "not_covered 遗漏 PI-07 的『恢复原文件/角色工具规则变化/冷恢复』子项"
      impact: "P0 门禁看起来比实际取证更宽"
      remediation: "补充 not_covered 条目，disposition=pending"
      status: fixed
    - severity: non-blocking
      location: devagent/spikes/harness/pi-env.ts:8
      evidence: "注释声称不修改全局状态，但只有 process.cwd() 被断言"
      impact: "『不串 env』只有文字，没有检查"
      remediation: "收窄注释并在 pi-07 增加 process.env 不变检查"
      status: fixed
    - severity: non-blocking
      location: .agentdev/work/devagent-bootstrap-p0-20261004/implementation.md:33
      evidence: "引用当时尚不存在的 settlement.md；test.md 对 chmod 清理的描述不准确"
      impact: "证据可审计性下降，无运行时影响"
      remediation: "限定引用；pi-05 finally 复原 0o755；test.md 更正措辞"
      status: fixed
  overclaims:
    - "关键实况 3『根输入条目必须按第一个 role=user 定位』仅来自单样本 → 已补第二输入验证（并发现 append-only 单链导致 marker 子树嵌套）"
    - "关键实况 6『外层 abort+waitForIdle 到达静默』依赖恒真检查 → 已改为 session.isIdle"
    - "关键实况 6『失败工具结果如实持久化』只观察内存事件 → 已补 JSONL 落盘检查"
    - "pi-env『No global state is mutated』只验证 cwd → 已补 env 断言并收窄措辞"
    - "sdk-surface 中『agent_settled 无负载』『公开 subscribe 不含 turn_end 条目 ID』属类型/文档证据 → 已补公开 vs 扩展事件负载对比"
  questions: []
  result: failed    # 1 项 blocking
```

## Round 2 · 修复后独立复审（会话 P0SpikeReview2）

```yaml
review:
  task: devagent-bootstrap-p0-20261004
  reviewer_session: P0SpikeReview2    # 新独立上下文，只读
  scope: "Round-1 六项修复核实 + 新增断言（第二输入关联、公开/扩展 turn_end 负载、失败 ToolResult 落盘）+ 契约符合性复查"
  round1_verified: 全部 6 项核实为已修复（仍 open = false）
  reproduced:
    - "cd devagent && npx tsc --noEmit  # exit 0"
    - "cd devagent && npm run spikes    # exit 0，35/35"
    - "临时目录残留 0"
  findings:
    - severity: non-blocking
      location: .agentdev/work/devagent-bootstrap-p0-20261004/test.md:36（not_covered）+ implementation.md:33
      evidence: "I1 PI-01 要求「模板」场景；spikes 内无任何 template 相关代码，且未声明未覆盖 → PI-01 覆盖声明过宽"
      impact: "模板展开会改变进入 agent 的文本，可能与 marker→根条目关联交互，却无证据"
      remediation: "补模板输入检查（或声明未覆盖）"
      status: fixed   # 已补 /pi01-probe 模板输入检查，PI-01 17/17
  overclaims: []   # Round-1 的 overclaim 已全部消除
  result: passed
```

## Round 3 · 模板增量复审（会话 P0SpikeReview3）

```yaml
review:
  task: devagent-bootstrap-p0-20261004
  reviewer_session: P0SpikeReview3    # 新独立上下文，只读；仅审增量 + 全量回归
  round2_verified: true
  regression: none
  reproduced:
    - "cd devagent && npx tsc --noEmit  # exit 0"
    - "cd devagent && npm run spikes    # exit 0，36/36（PI-01 17、PI-02 5、PI-05 5、PI-07 9）"
  verified_delta:
    - "模板由 harness 的 promptsOverride 注入（pi-env.ts:291-297），spike 只调 prompt('/pi01-probe tpl-arg')，文本由固定版本 SDK 的 expandPromptTemplate/substituteArgs 生成 → 真实展开，非 spike 自造字符串"
    - "谓词可失败：未注册模板→原文保留；未替换参数→textHasArg=false；marker3 关联断裂→失败"
    - "promptsOverride 只在传入 promptTemplates 时生效，不影响既有 prompts/AGENTS.md 上下文发现；其余三条 spike 未受影响"
  findings:
    - severity: non-blocking
      location: .agentdev/work/devagent-bootstrap-p0-20261004/settlement.md:9
      evidence: "settlement.md 仍写 35/35（PI-01 16），与可复现的 36/36 不符（test.md/implementation.md 已更新）"
      impact: "归档的 P0 门禁记录与实测不一致"
      remediation: "更新为 36/36（PI-01 17）"
      status: fixed
  result: passed
```