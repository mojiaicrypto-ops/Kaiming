# Settlement · tools-and-images-20261022

## 结果

三项基础工具（`web_search`、`web_fetch`、`browser`）与主管会话的图片上传/回放已实现并验证：

- 工具按角色授权，read Task 保留外部读取、浏览器降级为只读；
- 图片走本地内容寻址存储，payload 与浏览器响应都只有 id，base64 只在投递给模型的那一刻存在；
- 界面可添加图片、消息与工具卡显示图片，刷新后仍然可见。

## 与正式文档的同步

| 文档 | 变更 |
|---|---|
| `docs/technicalnew/agents-and-tools.md` | G1 三表行加入新工具与只读规则；G2 新增三工具契约与「图片输入（U10）」；自定义 provider 声明 `input` |
| `docs/technicalnew/ui-design.md` | U5 输入框/工具卡图片；新增 U10 图片；U9 方法消费加入两条路由 |
| `docs/technicalnew/prompts/{chief,designer,developer,reviewer,tester,investigator}.md` | 各自新增外部事实/浏览器段落，版本号 +1 |
| `docs/technicalnew/gap-register.md` | N1/N2/N3 三项，均已关闭并附证据位置 |
| `docs/technicalnew/implementation-checks.md` | P7 外部工具、P8 图片输入 |
| `devagent/README.md` | Chromium 安装前提、附件与 work/web 目录、`check:tools` 命令 |

## 遗留与下一步

- 独立 Review/Test Agent 本轮未运行；证据为自动化用例与真实模型检查（`npm run check:tools` 4/4）。
- Brave 检索分支、Linux 首次安装 Chromium 未实测（见 test.md「未覆盖」）。
- 后续若需要：LSP diagnostics、`repo_diff` 只读方法（给 reviewer 看改动）、MCP 高级开关。均不在本包范围。
