# 会话归档 - 计划

## 目标

主管会话可以归档：归档后从左侧主列表收起，历史、Task、报告和项目文件全部保留；归档区可以恢复。没有当前未结束 Task、没有排队/运行/未核实中断的会话才能归档。现有清理（真正删除）保持原条件。

## 实现

- 存储：v18→v19 给 `sessions` 加 `archivedAt TEXT`；`SessionRow`/`getSession`/`listSessionSummaries` 暴露；`archiveSession` 用 revision CAS 写/清 `archivedAt`；`sessionArchiveGaps` 拒绝非 chief、外部固定通道、当前 Task、运行中/排队/未核实中断。
- RPC：`session.archive`（sessionId、expectedRevision、archived）；`session.list` 返回 `archivedAt`，仍返回全部主管会话，前端负责分栏。
- UI：`SessionRow` 增加 `archivedAt`；左侧只列未归档会话；底部“归档 N”折叠区列出归档会话，可恢复；行内归档按钮不提供当前会话；归档/恢复后刷新 rail，失败原样提示。
- 文档：C-02、runtime-contract、U6 方法表、验收场景。
- 非目标：不改变 cleanup 的删除条件；不删除任何项目文件、Task、报告；不归档专业成员 Session；不把归档做成项目级开关。

## 验证

- store：v18→v19 迁移、CAS、归档条件、恢复。
- server：`session.archive` 成功/拒绝/版本冲突、`session.list` 的 `archivedAt`。
- webapp：rail 分栏与恢复按钮；浏览器：归档后从主列表消失、归档区可见、恢复后回到主列表；忙会话/当前会话不能归档。
- `tsc`、服务端/webapp 全量测试、构建、聚焦浏览器、`check:prompts`。
