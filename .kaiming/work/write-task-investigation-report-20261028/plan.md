# Plan · write Task 内的只读调查报告

## 问题（用户实测）

write Task 在 clarify/analyze/design/plan 可派发 investigator，派单 `expectedKind=investigation`、`writeScope` 为空；investigator 无项目写工具，只能用 `agent_report` 回传。但 `Store.recordResult` 对 write Task 只接受 design/implementation/review/test/settlement，正式报告被 `INVALID_ARGUMENT` 拒绝；`reportTarget` 也会把 write 报告写进项目，等于让只读调查落成项目交付。

## 决定

- write Task 接受 investigator 的 investigation/recovery 结果，作为只读证据，不充当结算。
- 这两类报告按 **kind** 而非 Task 类型保存到 Server `work/<taskId>/<sessionId>/`；其他 write 报告仍写项目 `.dev/work/`。
- `agent_report` 仍由宿主保存正文并核对回读，investigator 不需要项目写工具、也不需要 writeScope。

## 改动

| 文件 | 改动 |
|---|---|
| `src/store/store.ts` | write Task 的允许 kind 增加 investigation/recovery |
| `src/runtime/report-store.ts` | investigation/recovery 一律 `storage=server` |
| `test/report.test.ts` | write + investigator + investigation 回归用例 |
| `docs/technicalnew/agents-and-tools.md`、`storage-and-recovery.md`、prompts | 明确只读报告的保存位置与不完成 Task |
| `docs/technicalnew/validation.md` | 记录问题、修正与证据 |

## 验收

- write Task 中 investigator 的 passed/blocked 报告可保存，正文可读回。
- 报告 `bodyRef.storage=server`，项目 `.dev/work/<taskId>/` 不因该报告出现。
- write Task 完成仍要求 settlement；investigation 不能作为完成报告。
