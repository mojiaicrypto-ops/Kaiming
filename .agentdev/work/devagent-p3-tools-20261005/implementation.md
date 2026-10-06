# Implementation Summary · devagent-p3-tools-20261005

按切片推进：A 上下文装配（已提交 d8749c0）→ B 角色与工具集（本切片）→ C/D/E 待做。

## 切片 A · 上下文装配（已完成并提交）

```yaml
slice: P3-a 上下文装配
changed:
  - devagent/src/runtime/prompt-assembly.ts：按 G4 边界抽取注入正文；缺边界/重复（起点与终点）即报错；chief=base+自身，专业=base+共同规则+自身
  - devagent/src/runtime/context.ts：单轮上下文文本（纯函数，已单测）
  - devagent/src/runtime/{config,pi-runtime,registry,runner}.ts：promptDir、appendSystemPrompt 追加注入、按角色正文校验
  - devagent/checks/prompt-language.ts：复用产品抽取模块 + 边界字面量与抽取起点断言（15/15）
review: 独立审阅 passed；2 项 non-blocking + 3 项 overclaim 全部修复并复核通过（见 review.md）
```

## 切片 B · 角色与工具集（本次）

```yaml
slice: P3-b 角色与工具集
changed:
  - path: devagent/src/runtime/tool-sets.ts（新增）
    purpose: 按 G1 定义各角色的原生工具与领域工具集合；read Task 去掉项目写工具与任意 shell，也去掉会写项目文件的领域工具（requirement/project）；尚无 Task 时沿用角色自身集合
  - path: devagent/src/runtime/runner.ts
    purpose: 会话允许列表改为「角色×Task 类型」集合 ∪ 宿主已注册工具名；实际使用的工具集与 Task 类型写入 effectiveConfig
  - path: devagent/src/runtime/registry.ts
    purpose: 允许列表随会话创建透传（配置变化重建时同样生效）
  - path: devagent/test/tool-sets.test.ts（新增）
    purpose: 工具集矩阵单测（9 项）
  - path: devagent/test/runtime.test.ts
    purpose: 集成用例：Reviewer 在 write Task 中仍只读；Developer 在 write Task 有 write/edit/bash、在 read Task 没有；effectiveConfig 记录真实工具集与 Task 类型
behavior:
  - "写工具一定带读工具：designer/developer/settler 的集合都包含 read/grep/find/ls（有断言），先分析再改"
  - "只读角色（chief/reviewer/tester/investigator）任何 Task 类型下都没有 write/edit；tester 只有 bash 用于跑测试入口"
  - "read Task 一律去掉 write/edit/bash、requirement/project；agent_report 保留（它写的是 Server 侧报告，不是项目文件）"
  - "尚无 Task 的会话（如主管自己的会话）沿用角色自身集合：chief 仍能保存需求/初始化项目入口"
  - "允许列表含未被注册的工具名时不报错（实测：主管会话允许列表含 createTask 等尚未注册的名字，运行正常）"
  - "实测：npm test 71/71（6 个文件）；typecheck 0；check:prompts 15/15；SDK 试验 47/47；真实模型端到端 4/4"
review_round_1:
  - 独立审阅判定 failed：1 项 blocking + 3 项 non-blocking
  - (blocking) 实例复用只按配置指纹：Task 类型变化（write→read）会继续沿用旧的更宽工具集 → 复用键改为包含「工具允许列表 + 注入正文」，并以实例自身文件比对历史绑定；新增「Task 类型切换必须重建实例」用例
  - (non-blocking) 宿主工具并入允许列表时会把 read Task 已排除的 requirement/project 又加回来 → toolSetFor 暴露 denied（覆盖角色级全部未持有名字），并入时过滤；新增「denied 名字不会被并回来」用例
  - (non-blocking) effectiveConfig 记录的是"请求的允许列表"而非真正激活的工具 → 改为同时记录 requestedTools 与 activeTools（activeTools 取自会话本身）
  - (non-blocking) 专业角色的 task/requirement 工具范围比 G1 宽（G1 只给 task.get、requirement.list/get）→ 已在 tool-sets.ts 注释与本节记录中显式声明为 P3-e 必须收口的要求（工具内部 op 级权限）
  - 复跑：71/71 测试；typecheck 0；check:prompts 15/15；SDK 试验 47/47；真实模型端到端 4/4
  - 增量复核（同一独立会话）结果见 review.md
plan_deviation:
  - "read Task 目前整体去掉 requirement/project 工具，而不是只去掉 requirement.save：工具内部的 op 级权限属 P3-e；这样宁可少给工具也不放松写权限"
  - "RuntimeDefaults.tools 现在只是工厂在未指定 spec.tools 时的默认值；运行器始终传自己的角色集合"
risks_remaining:
  - "工具允许列表不是 OS 沙箱（契约已声明）；真实影响仍由 Agent 判断、程序核对文件与版本"
```

## 后续切片（计划内，未开始）

```yaml
pending: [P3-c Task 核心工具（createTask/updateTask/endTask/task + 计划落盘）, P3-d 委派与等待（createTaskSessions + 聚合 + 超时）, P3-e 报告与需求工具（agent_report/requirement/project）]
```