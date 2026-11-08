# 开明安装与启动

**简体中文** | [English](install.en.md)

本页是首次部署、升级和运维的完整说明。项目概览见 [README](../README.md)。

## 1. 运行环境

- macOS 或 Linux（POSIX）；Windows 未验证。
- Node.js **24 LTS**。推荐 24.22.1+；较早的 24.x 可以运行，但 `officeparser` 可能打印 engine warning。
- npm（随 Node 安装）。
- 一个可用的模型端点：OpenAI 兼容、Anthropic Messages 或本地 OpenAI 兼容服务。
- 可选：Chromium，供 Agent 的浏览器工具使用；不装不影响其它功能。

不需要 Docker。开明不是全局命令，克隆到任意目录即可。

## 2. 推荐安装：一键脚本

在仓库根目录执行：

```bash
./scripts/setup.sh
./scripts/start.sh
```

`setup.sh` 做四件事：

1. 在 `kaiming/` 和 `kaiming/webapp/` 安装依赖（有 lockfile 时使用 `npm ci`）；
2. 构建 `kaiming/web-static/`；
3. 如果 `kaiming/.env` 不存在，生成随机访问口令和本地配置，权限设为 600；
4. 打印启动地址和口令。

然后打开：

```text
http://127.0.0.1:4173
```

输入 `kaiming/.env` 中的 `KAIMING_ACCESS_PASSWORD` 登录。

重新运行 `setup.sh` 不会覆盖已有 `.env`，因此不会改变口令。升级代码后重新执行它即可刷新依赖和构建，首次启动时数据库会按需迁移。

## 3. 手动安装与启动

不使用脚本时：

```bash
cd kaiming

npm ci
npm --prefix webapp ci

npm run build

cp .env.example .env
chmod 600 .env
# 编辑 .env，至少设置一个足够长的 KAIMING_ACCESS_PASSWORD

npm start
```

`npm start` 等价于：

```bash
node --env-file-if-exists=.env src/server/main.ts
```

服务端启动日志会显示监听地址和数据目录。缺少访问口令时进程直接退出，不会启动一个无密码工作台。

## 4. 配置模型

### 4.1 在界面中配置（推荐）

登录后进入 **Settings → Models**：

1. 添加 provider：名称、Base URL、协议（OpenAI chat/completions、OpenAI responses 或 Anthropic messages）；
2. 添加模型 id；需要时声明推理能力和上下文窗口；
3. 保存 API key；
4. 选择默认模型，保存后测试连接。

密钥只保存在服务端，浏览器设置页不会再次显示明文。

### 4.2 通过环境变量选择

`.env` 中可以指定默认模型：

```dotenv
KAIMING_MODEL_PROVIDER=deepseek
KAIMING_MODEL_ID=deepseek-flash
```

两者默认都是 `unset`。`unset` 时工作台仍可启动并读取项目、会话、待办和历史，但输入不会被模型执行，界面会说明缺少模型配置。

### 4.3 直接维护模型文件

服务端把凭证交给 Pi。数据目录下可使用：

```text
<dataDir>/models.json     provider 定义（baseUrl / api / apiKey / models）
<dataDir>/auth.json       通常写 []
```

OpenAI 兼容端点示例：

```json
{
  "providers": {
    "deepseek": {
      "baseUrl": "https://api.deepseek.com/v1",
      "api": "openai-completions",
      "apiKey": "<your-api-key>",
      "models": [{ "id": "deepseek-flash", "name": "deepseek-flash" }]
    }
  }
}
```

`KAIMING_MODEL_PROVIDER` / `KAIMING_MODEL_ID` 必须与这里的 provider 和 `models.id` 一致。模型不可用时输入会留在队列并明确报告 `MODEL_UNAVAILABLE`，不会静默换模型。

`kaiming/config/model.json` 只供 `npm run check:model` 等真实模型检查脚本使用，服务端不读它，且已被 gitignore。

## 5. 环境变量

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `KAIMING_ACCESS_PASSWORD` | 是 | 无 | 浏览器访问口令；为空时拒绝启动 |
| `KAIMING_DATA_DIR` | 否 | `./.kaiming-data` | 数据目录，也作为模型凭证目录 |
| `KAIMING_HOST` | 否 | `127.0.0.1` | 监听地址；远程暴露前先读 [安全边界](#9-安全边界) |
| `KAIMING_PORT` | 否 | `4173` | 监听端口 |
| `KAIMING_MODEL_PROVIDER` | 否 | `unset` | 默认模型 provider id |
| `KAIMING_MODEL_ID` | 否 | `unset` | 默认模型 id |
| `KAIMING_RUN_STALL_MS` | 否 | `900000` | run 无任何 Pi 事件超过该值即中止 |
| `KAIMING_RUN_TOTAL_MS` | 否 | `5400000` | run 计费时长上限；等待用户/成员的时间不计 |
| `KAIMING_BASH_TIMEOUT_SECONDS` | 否 | `600` | 模型未给 bash timeout 时的宿主默认值；`0` 关闭 |

外部 Agent 接入另有 `KAIMING_MCP_URL`、`KAIMING_MCP_PROJECT` 等变量，见 [MCP 服务](technicalnew/mcp-service.md)。

## 6. 数据目录与安装位置

默认 `KAIMING_DATA_DIR` 是启动目录下的 `.kaiming-data`；通过 `scripts/start.sh` 启动时就是 `kaiming/.kaiming-data`。

```text
<dataDir>/state.db                 SQLite：项目、会话、输入、Task、结果、交互
<dataDir>/sessions/*.jsonl         Pi 原生会话历史
<dataDir>/models.json, auth.json   模型凭证
<dataDir>/attachments/             图片和文档附件
<dataDir>/work/<sessionId>/web/    web_fetch 落盘正文
```

以下内容**不在**数据目录中：

- **项目目录**：工作台记录你选择的既有目录，不复制项目文件。
- **浏览器构建**：`kaiming/web-static/`，由 `npm run build` 生成。
- **启动配置**：`kaiming/.env`，与数据目录分开；备份数据时也要按密钥备份它。

不要把项目目录放进数据目录：工作台会把私有目录内的文件视为不可访问，导致项目工具被拒绝。

## 7. 备份、恢复与升级

### 备份

最干净的备份是停止工作台后复制数据目录：

```bash
tar -czf kaiming-backup-$(date +%Y%m%d).tgz -C kaiming .kaiming-data
```

同时按密钥保管 `kaiming/.env`。项目目录按你自己的方式备份，工作台不代管。

### 恢复

```bash
# 停掉工作台
tar -xzf kaiming-backup-YYYYMMDD.tgz -C kaiming
./scripts/start.sh
```

使用与备份时相同的 `KAIMING_DATA_DIR`。恢复后应能看到原项目、会话、待办、Task 和报告；`sessions/*.jsonl` 决定原生会话能否续办，应与数据库一起恢复。

### 升级

```bash
# 先备份
git pull
./scripts/setup.sh
./scripts/start.sh
```

启动时会执行本地数据库迁移。不要删除旧数据目录来“修复”升级失败；先保留数据、记录错误，再处理迁移或版本问题。

## 8. 外部 Agent 接入（MCP）

工作台提供 stdio MCP 和常驻 `/mcp` 端点。Codex / Claude Code 这类客户端使用 stdio 子进程配置，例如：

```json
{
  "mcpServers": {
    "kaiming": {
      "command": "node",
      "args": ["/absolute/path/to/repo/kaiming/src/mcp/main.ts"],
      "env": {
        "KAIMING_ACCESS_PASSWORD": "<same password as kaiming/.env>",
        "KAIMING_DATA_DIR": "/absolute/path/to/repo/kaiming/.kaiming-data",
        "KAIMING_MCP_PROJECT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

要点：

- `KAIMING_MCP_PROJECT` 必须是项目绝对路径；工作台不会继承服务进程的 cwd 作为隐式项目。
- stdio 进程会优先附着已运行且应答的工作台实例；没有实例时才自己启动一个。
- 常驻端点 `/mcp` 服务多个项目，工具调用必须带 `project_path`（除非部署时设置了 `KAIMING_MCP_PROJECT`）。
- 认证使用同一个访问口令；不要把口令写进可公开的客户端配置。

完整工具面、错误和验证见 [MCP 服务](technicalnew/mcp-service.md)。

## 9. 安全边界

- 默认只监听回环地址。直接暴露到公网需要自行加 HTTPS、反向代理和访问控制；本项目不是托管多租户服务。
- 访问口令只保存在 `kaiming/.env`；模型 key 保存在数据目录或服务端配置中。不要把 `.env`、`config/model.json` 或数据目录提交到 Git。
- Agent 的 `bash` 与启动工作台的系统用户同权限。工作台没有操作系统级沙箱；不要把不可信仓库交给它执行，也不要授予不必要权限。
- 模型的文件工具会拒绝读取服务器私有目录（数据目录、凭证、数据库、会话历史），但 `bash` 的刻意绕过仍需由操作系统权限约束。
- 单用户设计；团队账号、RBAC、托管服务和自动多租户隔离不在当前范围。

## 10. 故障排查

| 现象 | 处理 |
|---|---|
| `scripts/start.sh` 提示缺少 `.env` | 先运行 `./scripts/setup.sh`，或按手动步骤创建 `.env` |
| 登录提示口令错误 | 查看 `grep KAIMING_ACCESS_PASSWORD kaiming/.env`；无 `.env` 时不会启动 |
| 页面提示未构建 | 运行 `npm --prefix kaiming run build` |
| 输入一直排队并提示 `MODEL_UNAVAILABLE` | 在 Settings → Models 配置并测试模型，或检查数据目录 `models.json` |
| 浏览器工具返回 `BROWSER_UNAVAILABLE` | 在 `kaiming` 下运行 `npx playwright install chromium` |
| 端口被占用 | 修改 `.env` 的 `KAIMING_PORT`，或停止占用端口的进程 |
| npm 提示 Node engine warning | 升级到 Node 24.22.1+；较早的 24.x 仍可运行 |
| 数据目录迁移失败 | 停止服务，保留数据目录和错误日志；不要删除旧数据 |

## 11. 开发与验证

```bash
cd kaiming
npm test
npm --prefix webapp test
npm run typecheck
npm --prefix webapp run typecheck
npm run test:browser
```

真实模型检查使用单独的 `config/model.json`：

```bash
cd kaiming
cp config/model.example.json config/model.json
# 填入 provider/model/key
npm run check:model
npm run check:runtime
npm run check:workflow
npm run check:tools
```

开发流程和验证档要求见 [任务交付](productnew/modules/delivery.md) 与 [AGENTS.md](../AGENTS.md)。
