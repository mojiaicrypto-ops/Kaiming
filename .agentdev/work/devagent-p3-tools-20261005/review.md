# Review Report · devagent-p3-tools-20261005

## 切片 A · 上下文装配 —— Round 1（会话 P3aContextReview）

```yaml
reviewer_session: P3aContextReview   # 独立上下文，只读
result: passed   # 2 项 non-blocking + 3 项 overclaim
verified_ok:
  - "G4 装配：chief = base + 自身；专业 = base + 共同规则 + 自身；只注入当前角色"
  - "追加而非替换：systemPrompt 仍含 Pi 原生块（<cwd>），长度大于注入文本"
  - "未知 roleId 在认领前被拒（blocked_role），输入保持 queued"
  - "effectiveConfig 含 promptDir，并参与配置指纹"
findings:
  - severity: non-blocking
    evidence: "终点边界（specialists 的 `## Role file map`）重复没有守卫，可能静默截断共同规则"
    remediation: "终点边界同样做重复检查并补负例"
    status: fixed
  - severity: non-blocking
    evidence: "记录称单轮上下文「有单测」，实际当时没有"
    remediation: "补 test/context.test.ts（切片 4 例 + 上下文 2 例）"
    status: fixed
overclaims:
  - "边界字面量缺少独立验证 → 已补「标题字面量恰好一次」与「抽取结果起点即该字面量」两项断言"
  - "负例只覆盖起点重复 → 已补终点重复"
```

## 切片 A —— 增量复核（会话 P3aContextReview）

```yaml
reviewer_session: P3aContextReview   # 同一独立上下文
result: passed
verified:
  - "终点边界重复现在被拒（探针：`## Role file map` 重复 → appears more than once）；起点重复同样被拒"
  - "test/context.test.ts 6/6；runtime 装配用例保持通过；无回归（typecheck 0、56/56、spikes 47/47）"
findings:
  - severity: non-blocking
    evidence: "字面量断言只检查标题是否出现一次，没有钉住抽取器实际使用的字面量"
    remediation: "断言抽取结果的起点就是文档化字面量"
    status: fixed
  - severity: non-blocking
    evidence: "测试记录未同步（当时仍写 50 项/13 检查）"
    remediation: "同步为 56/56、随后 14/14→15/15"
    status: fixed
  - severity: non-blocking
    evidence: "指向了当时不存在的 review.md"
    remediation: "写成本文件"
    status: fixed
residual:
  - "promptDir 内容变化不会触发实例重建（缓存以路径为键）；已记录在 risks_remaining"
```

## 切片 B · 角色与工具集 —— Round 1（会话 P3bToolsReview）

```yaml
reviewer_session: P3bToolsReview   # 新独立上下文，只读
result: failed   # 1 项 blocking + 3 项 non-blocking
verified_ok:
  - "七个角色的原生工具集与 G1 逐行一致；写能力角色都保留 read/grep/find/ls（有会失败的断言）"
  - "只读角色在任何 Task 类型下都没有 write/edit/bash；tester 只多 bash"
  - "read Task 去掉 write/edit/bash 与 requirement/project，agent_report 保留"
  - "接线改动没有波及其他调用方（spikes/checks 直接建会话；工厂仍以 config.tools 为默认）"
findings:
  - severity: blocking
    location: devagent/src/runtime/runner.ts:184-194 + registry.ts:37,48
    evidence: "实例复用只按配置指纹；Task 类型切换后仍沿用旧工具集（探针：第二次请求 write 工具，实际激活仍是 read 集）"
    impact: "write→read 的切换不会收回写工具，违反 G1 的 read Task 规则；套件无覆盖"
    remediation: "复用键包含有效工具集（并入注入正文）；历史文件与实例自身比对"
    status: fixed
  - severity: non-blocking
    location: devagent/src/runtime/runner.ts:187-189
    evidence: "宿主工具并入允许列表会把 read Task 已排除的 requirement/project 又加回来（一旦 P3-e 注册它们）"
    remediation: "toolSetFor 暴露 denied，并入时过滤"
    status: fixed
  - severity: non-blocking
    location: devagent/src/runtime/runner.ts:216-224
    evidence: "记录的是请求的允许列表，不是真正激活的工具（主管会话请求 12 个名字，实际激活 4 个）"
    remediation: "改为同时记录 requestedTools 与 activeTools"
    status: fixed
  - severity: non-blocking
    location: devagent/src/runtime/tool-sets.ts:49-54
    evidence: "专业角色的 task/requirement 工具范围宽于 G1（G1 只给 task.get、requirement.list/get）"
    remediation: "显式记录为 P3-e 必须收口的 op 级权限要求"
    status: fixed   # 已在代码注释与实施记录中声明
overclaims:
  - "「实际使用的工具集写入 effectiveConfig」与实现不符 → 已改为同时记录 requested/active"
  - "read Task 的保证被表述为端到端性质，实际只在 toolSetFor 层成立 → 已补 runner 层用例（denied 过滤）"
  - "记录未覆盖 Task 类型切换 → 已补切换用例"
```

## 切片 B —— 增量复核（会话 P3bToolsReview）

```yaml
reviewer_session: P3bToolsReview   # 同一独立上下文
result: passed
verified_first_delta:
  - "blocking 已闭环：复用键含工具集与注入正文，Task 类型切换会重建实例（探针：write 集 → read 集，create 调用 2 次，激活工具不含 write/edit/bash）"
  - "无重建循环：哈希输入每次输入确定性一致，第三次相同绑定复用；重建时始终带 piFile，历史连续"
  - "denied 过滤生效：read Task 下 requirement 不被并入，probe_ok 正常激活"
  - "记录含 requestedTools/activeTools"
second_delta_findings:
  - severity: non-blocking
    evidence: "denied 只覆盖两张表里已有的名字：新注册但未列入 DOMAIN_BY_ROLE 的领域工具既不被授予也不被拒绝，会被并入"
    remediation: "让「宿主注册的领域工具清单」与角色表来自同一来源"
    status: fixed   # 新增导出 DOMAIN_TOOL_NAMES 作为唯一来源，P3-e 必须按它注册
  - severity: non-blocking
    evidence: "记录里仍带一个继承自服务器默认的 tools 字段，与实际工具集无关"
    remediation: "去掉该字段（只留 requestedTools/activeTools）"
    status: fixed
  - severity: non-blocking
    evidence: "本文件此前只有「见下」，没有增量复核内容"
    remediation: "写成本节"
    status: fixed
  - severity: non-blocking
    evidence: "test.md 描述断言用的是已不存在的 tools 数组"
    remediation: "改为 requestedTools/activeTools"
    status: fixed
residual:
  - "promptDir 内容变化不触发实例重建（缓存以路径为键）"
```