# Plan · git-commit-gate-20261025

状态：Approved（用户指令：「好的按照第一步实现吧」，承接上一轮讨论的第一步）。
依据：产品 D-07「有 Git 的项目提交本次实际成果和交付记录，保留无关改动」；`agents-and-tools.md:131` write Task 完成条件；`prompts/settler.md:38`（settler 负责提交）；`store.ts:2198 completionBlockers`（当前完全没有 git 项）。

## 问题

`task end` 的完成核对只看成员停稳 / Review / 交付摘要 / Test / 结算报告，**不检查本次交付是否已经提交**。提交完全依赖 settler 记得自己敲 `git commit`，忘了也没有任何东西会失败——用户实测中「结算后没有 git 提交」正是这条链路。

## 目标

项目有 Git 且本次 Task 有已通过的独立 Review 时，**被 Review 覆盖的交付文件必须相对 HEAD 干净（已提交）**，否则 `task end` 拒绝收口，并把缺项与可执行命令返回给主管；提交仍由模型执行（本步不做程序代提交）。

```yaml
plan:
  task: git-commit-gate-20261025
  in_scope:
    - 宿主侧 git 观察（新模块 runtime/git-delivery.ts）：仓库判定、HEAD、指定路径的未提交改动
    - 完成门禁：endOp 在调用 endTask 之前叠加 git 缺项；缺项文案含未提交文件与命令
    - guidance 同步：completionFacts 的 gaps 与 end 一致（供 nextActions 与主管判断）
    - 契约同步：delivery.md D-07、agents-and-tools.md 完成条件、storage-and-recovery 收口顺序、
      prompts/chief.md、prompts/settler.md（提交责任不变，只补「不提交就收不了口」）
    - 测试：观察器矩阵；store 级 gate；任务工具的拒绝里出现 git 缺项
  out_of_scope:
    - 程序代执行 git commit（第二步，按讨论保留）
    - 回执里 commit hash 与 HEAD 的比对（模型自述，不进入本步门禁）
    - 要求 `.dev/work/**`、知识入口也进同一次提交：项目可以把这些目录 gitignore，
      强行要求会让任务永远收不了口；本步只门禁 Review 覆盖过的交付路径
    - 只读 Task、no-git 项目：维持原行为（本机保存）
  decisions:
    - 判定口径用 review.deliveryState.paths（程序观察所得，不是模型自述），与现有摘要校验同源
    - 无 git 仓库 → 不产生缺项（契约允许本机保存）；git 命令存在但仓库读不出来 → 阻断并说明，
      不静默放行（无法核实比假通过安全）
    - 提交由模型做：主管有 bash，可自己提交或派 settler；程序只观察与拒绝
    - 每次 task 工具调用会多一次 git 观察（仅当存在已通过的 Review）；超时 5s，失败即缺项
  steps:
    - id: G1
      change: runtime/git-delivery.ts —— 仓库/HEAD/路径 dirty 观察 + 缺项文案
      verify: [无仓库→no-git；有仓库且干净→无缺项；改动/未跟踪→有缺项；路径外改动不触发；空仓库]
    - id: G2
      change: tools/completion-git.ts —— 由 store 取最新 passed Review 的 paths 与 cwd 组合观察
      verify: [无 Review→无缺项；Review 无 deliveryState→无缺项；只读 Task→无缺项]
    - id: G3
      change: endOp 在 endTask 之前叠加 git 缺项；guidance.completionFacts 复用同一判定
      verify: [未提交时 end 返回 COMPLETION_INCOMPLETE 且含路径与命令；提交后该缺项消失；已满足时 end 正常收口]
    - id: G4
      change: 契约与提示词同步（见 in_scope）
      verify: [文档与实现逐条对应，无「程序代为提交」的错误表述]
  risks:
    - 同一文件里用户的手改会被一起算作本次交付（现状即按文件级摘要核对，未新增口径）
    - git 命令不可用但仓库存在 → 阻断；用户需修复环境或明确说明后才能收口
```

## 验证基线

- 服务端 `npx vitest run`（现 345 例）、webapp 31、浏览器 40 全绿。
- 真实项目冒烟：在一个临时 git 仓库里建 Task → 改动交付文件 → `end` 被拒并给出命令 → 提交 → 缺项消失。
- 独立 Review 与独立 Test 由独立 Session 完成（不读本会话）。

## 交付物

`.agentdev/work/git-commit-gate-20261025/{plan,implementation,review,test,settlement}.md`；代码与文档提交见结算。
