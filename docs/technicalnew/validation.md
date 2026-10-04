# 当前设计文档验证

本页记录当前文档证据，不定义协议。日期：2026-10-04。

## 范围与独立审阅

覆盖七角色完整提示词及上下文装配、需求规则单一权威/共用引用、双类型文件格式、Task/专业委派、Pi 原生交互宿主直转与等待、存储恢复、结算保存顺序及产品验收。

独立 Reviewer 在干净上下文中读取当前 AGENTS、索引和正式文档，未读取作者聊天、旧设计或业务代码。结论：无剩余阻断冲突。已复核报告先纳入 Git 后登记、已投递工作恢复采用关联新输入、需求最终文件先保存再 endTask 同版核对。详细记录见 [本轮 Review](../../.agentdev/work/role-context-normalization-20261004/review.md)。

## 实际文档检查

| 检查 | 结果 | 证据 |
|---|---|---|
| 独立文档 Review | Passed | 本轮独立报告，检查职责、参数、流程和异常一致性 |
| 本地文件/标题链接 | Passed | AGENTS、INDEX、当前产品与技术共 28 份 Markdown；脚本校验全部本地引用 |
| 图语法 | Passed | Mermaid 11.12.0 实际解析全部 8 张图 |
| 协议示例 | Passed | 4 个 JSON 示例实际解析；3 段 TypeScript 经严格类型检查 |
| 工具与角色入口 | Passed | 9 个领域工具，四个主管核心工具均在 Chief 中；七角色完整正文存在，G4 规定实际装配及可读取规范入口 |
| 产品验收编号 | Passed | AC-01～AC-35 连续唯一；AC-35 检查规则归一化 |
| 变更格式 | Passed | 限定本轮文档和工作记录的 git diff --check |

检查提取物在 `/tmp/agentdev-doc-check.C8cqSd`，未增加项目依赖。入口：

```sh
node /tmp/agentdev-doc-check.C8cqSd/current-docs.mjs
node /tmp/agentdev-doc-check.C8cqSd/check.mjs /tmp/agentdev-doc-check.C8cqSd/current-mermaid.json
node_modules/.bin/tsc --ignoreConfig --noEmit --strict --skipLibCheck --target es2022 /tmp/agentdev-doc-check.C8cqSd/current-contracts.ts
git diff --check -- docs/productnew docs/technicalnew docs/INDEX.md .agentdev/work/role-context-normalization-20261004
```

## 实施证据边界

固定 Pi v1.0.0 与 OMP 主源核对依据保留在相关契约的直接源码链接，本轮不把已有源码核对当作新的运行证据。SDK 接入、实际模型行为、崩溃/取消/容量试验和浏览器产品验收均为 **NOT_RUN**。下一步按 [实现检查](implementation-checks.md) 取得证据；文档 Passed 不表示功能已实现。
