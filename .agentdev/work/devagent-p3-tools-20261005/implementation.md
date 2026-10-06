# Implementation Summary · devagent-p3-tools-20261005（切片 P3-a 上下文装配）

```yaml
implementation:
  task: devagent-p3-tools-20261005
  slice: P3-a 上下文装配
  changed:
    - path: devagent/src/runtime/prompt-assembly.ts（新增）
      purpose: 按 G4 边界从提示词文件抽取注入正文；缺边界/边界重复即报错；装配规则 chief=base+自身、专业=base+共同规则+自身
    - path: devagent/src/runtime/context.ts（新增）
      purpose: 单轮上下文文本（输入 ID、Task 摘要、阶段、总体 Plan、授权引用、正式依据、依赖结果），纯函数
    - path: devagent/src/runtime/config.ts
      purpose: RuntimeDefaults/EffectiveConfig 增加 promptDir；去敏视图含 promptDir（非密钥）
    - path: devagent/src/runtime/pi-runtime.ts
      purpose: CreateSessionOptions 支持 appendSystemPrompt，传给 DefaultResourceLoader（追加，不替换 Pi 原生说明）
    - path: devagent/src/runtime/registry.ts
      purpose: 装配文本随会话创建透传（配置变化重建时同样带上）
    - path: devagent/src/runtime/runner.ts
      purpose: 按 promptDir 缓存正文；认领前校验 roleId 有对应正文（否则 blocked_role，输入保持 queued）；投递前把装配文本作为 appendSystemPrompt 注入
    - path: devagent/test/runtime.test.ts
      purpose: 新增装配注入用例（chief 得到 base+chief 且保留 Pi 原生块；reviewer 得到共同规则+自身正文且不含 chief 正文；未知角色被拒且不认领）
    - path: devagent/test/context.test.ts（新增）
      purpose: 装配与单轮上下文单测：切片起点/终点、缺失与重复边界报错（起点与终点各一例）、buildTurnContextText 的完整与非完整分支
    - path: devagent/checks/prompt-language.ts
      purpose: 改为复用产品抽取模块（不再复制边界逻辑），并新增两项独立断言：边界标题字面量（每份文件恰好一次）与「起点/终点重复必须报错」（15/15）
    - path: devagent/checks/runner-real-model.ts
      purpose: 真实模型检查补 promptDir
  review_round_1:
    - 独立审阅判定 passed：2 项 non-blocking + 3 项 overclaim
    - (1) 终点边界（specialists 的 `## Role file map`）重复没有被守卫，可能静默截断共同规则 → 已补终点重复检查，并在检查脚本与单测中各加一例
    - (2) 实施记录称单轮上下文「有单测」，实际当时没有 → 已补 test/context.test.ts（切片与上下文分支），记录随之改为准确表述
    - (3) 检查脚本改为复用产品抽取后，边界字面量本身缺少独立验证 → 已新增「边界标题字面量出现恰好一次」的独立断言
    - 复跑：50→56 项测试全通过；check:prompts 15/15；typecheck 0；真实模型端到端 4/4
    - 增量复核（同一独立会话）结果见 review.md
  behavior:
    - "注入：先写书签再交付不变；会话级注入 = base（+专业共同规则）+ 当前角色正文，追加到 Pi 原生说明之后"
    - "隔离：只注入当前角色正文；专业会话不含 chief 正文，chief 会话不含专业共同规则"
    - "失败即拒：边界缺失/重复（起点与终点）、roleId 无正文都直接报错/阻断，绝不注入半份规则或空规则运行"
    - "实测：npm test 56/56；typecheck 0；check:prompts 15/15；SDK 试验 47/47；真实模型端到端 4/4（含角色注入后的完整链路）"
  plan_deviation:
    - 单轮上下文（Task/Plan/授权/依据）本轮只实现为纯函数并有单测；真正投递要等 P3-c/d 建立 Task 与 Plan 后再接（并需确认复用 notice 通道还是新增 customType）
    - 角色工具集裁剪（P3-b）、四个核心工具（P3-c）、委派等待（P3-d）、报告与需求工具（P3-e）尚未开始
  risks_remaining:
    - 装配文本随配置指纹一起参与实例复用判断；若将来 promptDir 内容变化而路径不变，需要显式规则（当前按路径与配置判断）
```