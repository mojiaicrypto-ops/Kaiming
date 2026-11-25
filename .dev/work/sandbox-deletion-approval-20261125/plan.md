# 沙箱激活时的删除确认收敛

日期：2026-11-25
验证档位：`broad`（共享权限契约与 bash 执行边界）

## 目标与验收

当 `KAIMING_SANDBOX=auto|strict` 的启动探针已生效时，持有工作区写权限的专业角色执行普通文件删除不再弹确认；`off`、缺少/失败沙箱、主管只读会话和高危 Git 清理仍保留原有确认。删除仍受 P3-1 OS 沙箱与角色边界约束。

验收：

1. `designer`/`developer`/`tester` 在 `auto`/`strict` 生效时执行 `rm`、`rmdir`、`find -delete`、脚本删除（`fs.rmSync` 等）不再创建交互。
2. 同一台机器 `KAIMING_SANDBOX=off` 时，上述普通删除仍弹确认；沙箱不可用或未配置时行为不变。
3. `git clean -f`、`git stash drop/clear`、`git branch -D` 在沙箱生效时仍弹确认；主管 history 规则、read-only 沙箱拒绝和 `Trust all` 语义不变。
4. 写入测试脚本的 heredoc 正文（`cat > file <<'EOF'`、`python3 - <<'PY'` 等）不再因为正文里的 `rmSync`/`os.remove` 触发删除确认；heredoc 结束后的真实删除命令仍被识别。
5. 不引入 Task 级信任、项目级开关、新 UI 或前端配置。

## 依据与已确认决定

- 产品 [P-05](/Users/huyaohua/huyh/work/aigrouptool/docs/productnew/modules/project-workspace.md) 与 [AC-65](/Users/huyaohua/huyh/work/aigrouptool/docs/productnew/acceptance.md) 定义 `auto|strict|off`、角色边界和「保护已关闭」。
- 技术 [G1](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/agents-and-tools.md) 定义 shell 门禁；当前 `trustedSessions` 为 session 内存集合。
- 2026-11-25 用户确认：采用 A；不把 inside-workspace untracked 文件的保护纳入本次范围；不增加复杂性。
- 当前 state.db 中存在 `q-4e8a5390`（`s-73e06eea` / `t-b601964eb02a`）pending，命令只是用 heredoc 写 B-42 测试脚本，正文出现 `rmSync`；这是 heredoc 误判的现场证据。

## 实现范围

- `kaiming/src/runtime/deletion-gate.ts`
  - 识别 heredoc 正文并在规则匹配前排除正文；保留 heredoc 命令和结束后的真实命令。
  - 将删除规则分为普通文件删除与高危 Git 清理；沙箱生效时只跳过普通文件删除。
  - 新增 `sandboxActive` 选项；`off`、只读角色和不生效沙箱保持现有路径。
- `kaiming/src/runtime/runner.ts`
  - 仅在 `sandbox.status.active` 且策略为 `workspace-write`（designer/developer/tester）时传 `sandboxActive: true`；settler/chief 不扩大。
- 测试：`kaiming/test/deletion-gate.test.ts` 覆盖 heredoc、正向删除、沙箱跳过和高危 Git 负控制；`deletion-gate-runtime.test.ts` 保持现有交互证据。
- 文档：P-05、AC-66、G1、base/specialists 的删除说明，以及 validation 记录。
- 不改：OS 沙箱策略、角色工具集合、文件工具边界、Trust all 的内核含义、无 Task/UI 状态。

## 风险

- 沙箱内项目目录的 untracked 文件可被普通删除命令删除；用户已明确接受，本次不做项目级开关或逐文件提示。
- 文本门禁不是解析器；heredoc 处理按行识别，复杂嵌套/多重 heredoc 仍可能漏判或误判，需要通过测试和真实 pending 命令覆盖常见形态。
- 当前 workbench 运行的是旧代码；验证和最终生效需要重启，pending 交互不会自动消失。
