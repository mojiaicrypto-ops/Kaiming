# Review Report · devagent-p3-tools-20261005（切片 P3-a 上下文装配）

## Round 1 · 独立只读审阅（会话 P3aContextReview）

```yaml
review:
  task: devagent-p3-tools-20261005
  slice: P3-a 上下文装配
  reviewer_session: P3aContextReview   # 独立上下文，只读
  reproduced:
    - "npx tsc --noEmit → 0；npm test → 50/50（当时）；npm run check:prompts → 13/13；npm run spikes → 47/47"
    - "单独运行 role context injection 用例：3 通过"
    - "对 prompt-assembly 直接探针：终点边界重复不会被拒"
  result: passed
  findings:
    - severity: non-blocking
      location: devagent/src/runtime/prompt-assembly.ts:59-69
      evidence: "起点边界有重复守卫，终点边界（specialists 的 `## Role file map`）没有；重复或正文里提到该标题都会静默截断共同规则"
      impact: "共同规则可能被截半注入而运行仍报 completed（当前文件恰好各一次，属潜在缺陷）"
      remediation: "终点边界同样做重复检查并补负例"
      status: fixed
    - severity: non-blocking
      location: .agentdev/work/devagent-p3-tools-20261005/implementation.md:32
      evidence: "记录称单轮上下文「有单测」，实际当时无任何测试引用 buildTurnContextText"
      impact: "记录夸大验证范围"
      remediation: "补单测或改措辞"
      status: fixed   # 新增 test/context.test.ts（切片 4 例 + 上下文 2 例）
  overclaims:
    - "检查脚本改为复用产品抽取后，边界字面量本身缺少独立验证 → 已新增「标题字面量恰好一次」断言"
    - "负例只覆盖起点重复 → 已补终点重复"
  verified_ok:
    - "G4 装配：chief = base + 自身；专业 = base + 共同规则 + 自身；只注入当前角色"
    - "追加而非替换：systemPrompt 仍含 Pi 原生块（<cwd>），长度大于注入文本"
    - "未知 roleId 在认领前被拒（blocked_role），输入保持 queued"
    - "effectiveConfig 含 promptDir，并参与配置指纹"
```

## 增量复核（同一独立会话）

```yaml
review:
  reviewer_session: P3aContextReview   # 同一独立上下文，复核增量
  result: passed
  verified:
    - "终点边界重复现在被拒（探针：'## Role file map' 重复 → appears more than once）"
    - "起点重复同样被拒；单测与 check:prompts 各覆盖三种负例"
    - "test/context.test.ts 6/6 通过；runtime 装配用例保持通过；无回归（typecheck 0、56/56、spikes 47/47）"
  findings:
    - severity: non-blocking
      location: devagent/checks/prompt-language.ts:89-108
      evidence: "字面量断言只检查标题是否出现一次，没有钉住抽取器实际使用的字面量：把 base 的起点字面量换成 `## Judgment and expression` 仍能通过全部检查"
      impact: "抽取器内部的错误边界仍可能不被发现"
      remediation: "断言抽取结果的起点就是文档化字面量"
      status: fixed   # 新增「extracted slice begins with the documented boundary literal」断言
    - severity: non-blocking
      location: .agentdev/work/devagent-p3-tools-20261005/test.md
      evidence: "测试记录未同步（当时仍写 50 项/13 检查）"
      remediation: "同步为 56/56、14/14（随后又加一项断言）"
      status: fixed
    - severity: non-blocking
      location: .agentdev/work/devagent-p3-tools-20261005/implementation.md:34
      evidence: "指向了当时不存在的 review.md"
      remediation: "写成本文件"
      status: fixed
  residual:
    - "promptDir 的内容变化不会触发实例重建（缓存以路径为键）；已在 risks_remaining 记录，待后续按需处理"
```