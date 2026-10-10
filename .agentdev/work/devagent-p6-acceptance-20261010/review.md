# Review · devagent-p6-acceptance-20261010

独立上下文复核（不读开发聊天，只按 `productnew/acceptance.md`、本包记录、代码与真实产物核对）。两名复核者会话：`P6Verify`（首轮）、`P6Delta`（增量）。

## Round 1 · P6Verify · result: failed

```yaml
verdict: failed
findings:
  blocking: 1
  non-blocking: 12
blocking:
  - claim: "AC-01 pass，含“再以不同目录开 B/N 各自成项目”"
    verdict: false
    evidence: "两个实例的 request_receipts 里 13 次 project.open 全部返回同一 projectId p-051f7ff4ffbd（A）；state.db 只有一条 projects 行；备份件与恢复件同此。B/N 从未被打开为前提"
    remediation: "补做 B/N 分支或改为 not_run"
confirmed:
  - "not_run 各项的理由全部成立（rebind/cleanup 无浏览器入口、知识入口确不存在、无写 Task、无 handover、read Task 无 bash、task.reconcile 在提示词里被引用但代码不存在）"
  - "D1/D2/D3/D4/D5/D6 的修复在 61e5924 上确实成立（含真实数据：q-b1139752 在重启 epoch 后 2ms 变 stale、任务带 authorizationRefs [interaction:q-717b65e2]）"
  - "AC-22 通过成立（recovery 列有 stopped + evidenceRefs；无依据核实被服务端拒绝）"
overclaims:
  - "AC-05 的“等待/暂停 Task 仍占关联”分支未执行；且“53 条”是渲染消息数，不是记录总数（该会话今日 102 条记录、其中 53 条是 toolResult）"
  - "AC-20 的“子 Session 提问经主管入口呈现”分支未执行（4 次交互全属主管会话；investigator 转录无 question 调用）"
  - "AC-21 的“关浏览器/断线再开”分支未执行"
  - "AC-27 的角色/项目级模型覆盖未执行（无该入口），无效模型配置未实测"
  - "字典契约用例可被“把键当参数传给 helper”的写法绕过：删掉 inbox.questions 仍会绿——正是 D1 要防的那个 bug"
new_defects_found_by_review:
  - "D7 残留：被阻塞事件在每个空闲轮询重复发布（实测约 4 帧/秒、25 帧/6s），toast 反复触发、控制台无界增长"
  - "外壳残留：run.topLive 写死 Live · 1、aria.liveDockOpen 写死 1 running；阶段条直接印阶段 id，未翻译"
reported_numbers_wrong:
  - "测试数记 208（实为 209）；字典“删 147”不准确（实测 399 → 251：删 177、增 29）"
```

### 处理（commit `0ffb9f7`）

1. **阻断项**：真实浏览器补做 B/N —— 同一实例三项目（A `p-051f7ff4ffbd`、B `p-617c79822325`、N `p-3508b410d2a6`），各自路径/会话/内容独立；`test.md` 按实观重写，并保留“同目录重复打开 10 次回到同一项目”的去重证据。
2. **D7 残留**：`main.ts` 记住每会话最后一次阻塞签名，只在变化时发布（非阻塞结果清除签名）。实测 14 秒约 50 次轮询内 `blocked` 帧 = 1、toast 1 条、控制台 1 行。
3. **外壳残留**：`run.topLive` 改为 `Live`、aria 文案去掉假数量、阶段条改用 `t('phase.<id>')`。
4. **字典用例**：键解析断言改为覆盖“落在字典自有命名空间的字面量”，显式列出 3 个 RPC 方法名作为唯一白名单；变异验证（删 `inbox.questions` → 该断言失败）。
5. **记录纠正**：AC-05/20/21/27 改记 `部分 pass` 并写明未执行分支；键数与测试数按实测更正；补记“新建需求的 createdAt 由调用方提供”。

## Round 2 · P6Delta · result: passed（增量复核 `0ffb9f7`）

```yaml
verdict: passed
closed:
  - "阻断项（AC-01 B/N）真关闭：库里 projects 三行（A/B/N 各自 realPath 唯一），B/N 各有自己的会话与 cwd，project.open 的 15 条回执按 result 字段分别指向三个 projectId；B/N 目录没有 .dev，tasks 只有 A 的任务"
  - "阻塞通知不再重复：main.ts 只在签名变化时发布，非阻塞结果清除签名；帧形状与修复前一致，客户端分发不受影响"
  - "外壳残留关闭（**有二轮后的补正**）：run.topLive='Live'、阶段条用 t('phase.<id>')；但当时只改了字典值，静态标记里的 aria-label 仍是 'Live Dock, 1 running. Compact'，且 I18n.apply 只在切语言时执行——真正可见/可读的文案没变。二轮之后补正：index.html 的静态文案与 aria-label 改为无数字，并在启动时执行一次 i18n.apply(document)；浏览器验收新增断言（dock 的 aria-label 与可见文本都不含数字）"
  - "字典用例绕过关闭：解析断言覆盖字典自有命名空间里的字面量；变异复现删除 inbox.questions 即失败；键数 251/251 对称"
record_accuracy_nits:
  - "implementation.md 里 B 的 projectId 少写一位（已改 p-617c79822375）"
  - "AC-20 引用的 i-3a5e0bbe 是 investigator 自己的委派输入，真正等待的父输入是 c-mv1x96g5-14-803cc1（已改）"
  - "D1 段落里的“删 147 个键”与实测不符（399 → 251，删 177 增 29）——已在原处更正"
  - "白名单实为四个 RPC 名（含 auth.login，它同时是真实文案键）——记录已补齐"
handoff_note:
  - "复核时两个运行中的实例仍加载着 0ffb9f7 之前的内存代码（Node 只在启动时载入 main.ts）：观察“一次发布”行为前需要先重启进程；仓库无需改动"
```

### 处理

- 上述四处记录笔误已按实测改正（commit `见下一条提交`）；`test.md`/`implementation.md` 现在与工作台数据一致。
- 运行实例已重启，对外提供的静态文件与内存代码都来自同一提交。
