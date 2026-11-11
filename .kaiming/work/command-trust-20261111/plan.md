# 命令确认收窄与本次会话完全信任

## 用户确认的行为

- 默认只对真正删除的命令确认，不再对 `git checkout --`、`git restore`、`git reset --hard`、`git push --force` 确认。
- 删除确认框给出“本次会话完全信任”选项；选择后本会话后续所有 bash 命令（含删除）不再询问。
- 不改外部 Agent 客户端自己的审批策略。

## 实现范围

- `src/runtime/deletion-gate.ts`
  - 引号感知的 shell 分段，命令位置只认段首、包装命令后与 `$()`/反引号命令替换。
  - 只保留真正删除规则：`rm/rmdir/shred/unlink`、`find -delete`、`git clean -f`、`git stash drop/clear`、`git branch -D`、脚本删除。
  - 删除确认从 `confirm` 改为 `select`：`Approve once` / `Trust all commands in this session` / `Reject`。
  - 会话内 `trustAll` 状态；选择信任后不再调用 UI。
- `test/deletion-gate.test.ts`、`test/deletion-gate-runtime.test.ts`
  - 覆盖引号误报、Git 规则收窄、命令替换、三条确认路径与信任后跳过。
- 文档
  - `docs/technicalnew/agents-and-tools.md`、`docs/install.md`、验证记录。

## 非目标

- 不新增设置页/数据库字段。
- 不做 shell 沙箱；文本规则仍是近似边界。
- 不改变客户端（Codex/Claude Code）自己的命令审批。

## 验收

- `npm test -- deletion-gate` 通过。
- `npm run typecheck` 通过。
- 实跑脚本化模型：第一次删除弹一次 select；选“本次会话完全信任”后第二次删除直接执行且无交互。
