# 当前设计文档验证

本页只记录当前设计的审阅/检查，不作为协议定义。当前日期 2026-10-04。

## 工作范围与依据

当前设计入口为 [产品需求](../productnew/README.md)与[技术设计](README.md)。范围包含全局单 Server、主管总体 Plan/显式阶段、按步委派与中间交互返回、主管统一呈现授权，以及相应图、协议、工具、提示词、恢复和验收。业务代码未修改。

## 文档验证

| 检查 | 结果 | 当前证据 |
|---|---|---|
| 独立开发者审阅 | Passed | 独立上下文阅读产品/技术正文、提示词和验收；未读取作者聊天、旧实现或历史设计。当前流程、接口、接续与授权链路可供制定实施 Plan |
| Pi/参考实现主源核对 | Passed | Pi v1.0.0 固定 a13d35a742c6ef8462812a28fbe1d8c8b7431c32；OMP 固定 9348320cc4a30a7195d36a1f05a6c11bcb701a17。SDK/UI 语义、宿主取消责任、条件恢复与保守交接边界符合固定源码 |
| 文件/标题链接 | Passed | AGENTS、INDEX、当前产品与技术目录共 21 份 Markdown；本地文件及标题链接有效，无旧设计归档入口 |
| 流程图语法 | Passed | Mermaid 11.12.0 实际解析全部 8 张总图/执行/关系/协作/交互/恢复图 |
| 协议示例 | Passed | 4 个 JSON 示例实际解析；3 段 TypeScript 定义经 TypeScript 7.0.2 严格类型检查 |
| 工具/提示词一致性 | Passed | 8 个领域工具入口；四个主管核心工具均在 Chief 规则中；当前契约使用 interactionId，没有废弃接口引用 |
| 产品编号 | Passed | 原产品规则编号保留；AC-01～AC-28 共 28 项验收编号保留并更新行为 |
| 变更格式 | Passed | 限定当前产品/技术目录及索引的 git diff --check，无空白错误 |

静态检查脚本及提取物位于本轮临时目录 `/tmp/agentdev-doc-check.C8cqSd`，未加入项目依赖。执行入口：

```sh
node /tmp/agentdev-doc-check.C8cqSd/current-docs.mjs
node /tmp/agentdev-doc-check.C8cqSd/check.mjs /tmp/agentdev-doc-check.C8cqSd/current-mermaid.json
node_modules/.bin/tsc --ignoreConfig --noEmit --strict --skipLibCheck --target es2022 /tmp/agentdev-doc-check.C8cqSd/current-contracts.ts
git diff --check -- docs/productnew docs/technicalnew docs/INDEX.md
```

## 实施证据边界

SDK 接入、实际模型行为、崩溃/取消/容量试验和浏览器产品验收均为 **NOT_RUN**。下一步按 [实现检查](implementation-checks.md) 的前置试验和工作包实施；文档 Passed 不代表运行可靠性或功能完成。
