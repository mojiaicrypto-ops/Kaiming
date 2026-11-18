# P2-6 设计目录对全角色可见、backlog(op=edit) 语义对齐

状态：已确认（2026-11-18，用户选择方案 A + B1）
依据：K-02 / BL-02–BL-03 / D-09；`docs/technicalnew/prompts/base.md`、`chief.md`、`agents-and-tools.md` G2/G4
验证档：`focused`（提示词正文、工具描述、派发信封内容；无存储副作用）

## 观测事实

1. 设计完成门禁只认 `.dev/product/` 与 `.dev/technical/`（`src/runtime/deliverable.ts:103-114`、`src/runtime/design-completion.ts:20-22`），但主管提示词里从未出现这两个目录；只有 `designer.md:106` 写了默认职责，而主管不注入 designer.md（`prompt-assembly.ts:119-125`）。新项目里主管据正文猜成了 `.dev/specs`/`.dev/tech`，直到关单被拒。
2. `backlog(op=edit)` 是纯文本替换（`backlog-store.ts:919-940`），不刷新 `- 更新:`、不绑定当前 Task；但工具描述写“Writes allocate ids, record the source/actor/time”，主管据此误判设计师没走 backlog 工具。结构化 `updateItem` 存在但未暴露。

## 决定（A + B1）

- 调整提示词与工具描述，不改存储行为：不加 `update` op、不自动刷新 edit 的时间戳、不改 `editRaw` 的字节语义。
- base 对 Chief/专业角色统一写明固定知识目录；chief 写明设计门禁路径与 add/edit 的差别；backlog 工具描述改准确；project 工具描述点明布局；design+designer 派发信封自动附带一条宿主事实。
- 设计切片优先 `backlog(op=add, specRefs=…)`（宿主绑定产生者 Task）；把既有条目就地细化为切片时，用 `edit` 并在原文补 `- 规格:`（必要时 `- Task:`）。

## 改动面

| 文件 | 改动 |
|---|---|
| `docs/technicalnew/prompts/base.md` | v6：固定知识目录一段；第 15 段补 add/edit 语义 |
| `docs/technicalnew/prompts/chief.md` | v8：设计门禁读 product/technical；切片写入通道与 edit 限制 |
| `kaiming/src/tools/backlog-tools.ts` | 工具描述：add/close 与 edit 分开说明，design 切片用 add |
| `kaiming/src/tools/project-tools.ts` | 工具描述：知识目录布局与设计门禁 |
| `kaiming/src/tools/delegation-tools.ts` | design+designer 信封附宿主事实行 |
| `docs/technicalnew/agents-and-tools.md` | G4 记录 base 携带固定目录、design 信封携带门禁与切片通道 |
| 测试 | 信封只对 design+designer 出现，developer 不出现；prompt 正文包含目录与门禁字样（负向对照） |

## 验收与风险

- `test/delegation.test.ts`、`test/runtime.test.ts` 定向通过；`checks/prompt-language.ts` 通过（新增正文全英文）；`npm run typecheck`。
- 提示词正文按 `promptDir` 每进程缓存：改动只在 workbench 重启后生效；结算必须写明。
- 不改完成门禁本身，不迁移任何项目已有目录。
