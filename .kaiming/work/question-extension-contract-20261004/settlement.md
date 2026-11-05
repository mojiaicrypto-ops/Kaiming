# Pi 通用确认与 WAL 契约工作记录

日期：2026-10-04。范围：已确认的技术文档修改，未修改业务代码。

确认链路：模型决定问题及 confirm/select/input → UI 按类型渲染 → 用户回复写 WAL → 原调用取得答复 → 模型继续。

变更：G2 定义官方扩展注册方式与通用参数；M5 定义消息、答复及提交后接续；S2/S3 保存通用事实并复用已有等待/恢复机制。删除业务确认字段和 question 专用多轮机制；同步 Runtime、提示词基础规则、接入检查、技术导航和验证记录。项目 AGENTS 加入用户明确要求的简单优先规则。

独立审阅：[Review Passed](review.md)，/root/question_contract_review 只读复核，无范围内阻断。

静态检查通过：28 份 Markdown/162 个本地引用、8 张 Mermaid（11.12.0）、6 个 JSON、3 段 TypeScript 严格类型检查；差异格式检查通过。SDK/真实模型/浏览器/故障验收为 NOT_RUN；此次没有实现代码，不以文档验证替代运行验收。

完整审查 DA-03 已按确认后的边界关闭，其余七项仍开放。产品行为及验收不因本次技术简化改变；业务代码地图无新增位置。提交只包含本次规则、技术文档及审查记录，保护其他工作区改动。

实际命令（均退出码 0）：

```sh
node /var/folders/zs/p0l9stg552j3vgvzwmf0gnp80000gn/T/agentdev-question-contract-_ol9d9ac/current-docs.mjs
node /tmp/agentdev-doc-check.C8cqSd/check.mjs /var/folders/zs/p0l9stg552j3vgvzwmf0gnp80000gn/T/agentdev-question-contract-_ol9d9ac/current-mermaid.json
node_modules/.bin/tsc --ignoreConfig --noEmit --strict --skipLibCheck --target es2022 /var/folders/zs/p0l9stg552j3vgvzwmf0gnp80000gn/T/agentdev-question-contract-_ol9d9ac/current-contracts.ts
git diff --check -- AGENTS.md docs/INDEX.md docs/technicalnew
```

以上只是文档及示例检查，不证明运行功能已经实现。本次文档按明确路径独立提交。
