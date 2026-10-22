# AgentDev 工作台：安装、启动与备份

单用户、自管的浏览器工作台。一个实例只有一个全局 Server，管理该实例的多个项目与会话。

## 1. 运行环境

- Node 24（`node:sqlite` 仍标记实验，启动日志会出现一条 ExperimentalWarning，属正常）。
- 依赖已随仓库提供（`node_modules/` 已安装）。需要重装时在本目录执行 `npm install`。
- 无需构建步骤：服务端用 TypeScript 直接运行，前端是同源静态文件。
- 浏览器工具需要 Chromium 本体（`playwright-core` 只提供驱动）：首次使用前执行 `npx playwright install chromium`。没装时 `browser` 返回 `BROWSER_UNAVAILABLE`，其它功能不受影响。

## 2. 启动

```bash
cd devagent
AGENTDEV_ACCESS_PASSWORD='<你设置的口令>' \
AGENTDEV_MODEL_PROVIDER=deepseek \
AGENTDEV_MODEL_ID=deepseek-flash \
AGENTDEV_PORT=4173 \
AGENTDEV_DATA_DIR="$PWD/.agentdev-data" \
node src/server/main.ts
```

看到 `workbench listening on http://127.0.0.1:4173 (data: ...)` 即已启动。用浏览器打开该地址，输入上面设置的口令进入。

### 环境变量

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `AGENTDEV_ACCESS_PASSWORD` | 是 | 无 | 访问口令；为空时直接拒绝启动（退出码 2） |
| `AGENTDEV_DATA_DIR` | 否 | `./.agentdev-data` | 数据目录（见下）。同时作为模型凭证目录 |
| `AGENTDEV_MODEL_PROVIDER` | 否 | `unset` | 默认模型 provider id |
| `AGENTDEV_MODEL_ID` | 否 | `unset` | 默认模型 id |
| `AGENTDEV_PORT` | 否 | `4173` | 监听端口 |
| `AGENTDEV_HOST` | 否 | `127.0.0.1` | 监听地址（远程访问需自行评估暴露风险） |

模型两个变量填 `unset` 时也能启动：项目、会话、需求、任务、报告与文本文件都可读，输入不会被模型执行。要真正跑模型，见第 3 节。

## 3. 配置模型凭证

服务端自己不读模型配置文件，它把凭证交给 Pi（固定的 `@earendil-works/pi-coding-agent`）。凭证放在**数据目录**下：

```
<dataDir>/models.json     # provider 定义（baseUrl / api / apiKey / models）
<dataDir>/auth.json       # 通常写 []
```

OpenAI 兼容端点（含 DeepSeek、本地服务）示例 `models.json`：

```json
{
  "providers": {
    "deepseek": {
      "baseUrl": "https://api.deepseek.com/v1",
      "api": "openai-completions",
      "apiKey": "<你的 API key>",
      "models": [{ "id": "deepseek-flash", "name": "deepseek-flash" }]
    }
  }
}
```

`AGENTDEV_MODEL_PROVIDER`/`AGENTDEV_MODEL_ID` 必须与这里的 provider 与 models.id 对上。模型不可用（凭证缺失、id 不存在）时，提交的输入会留在队列里并以 `blocked_config MODEL_UNAVAILABLE` 说明原因，不会静默换用别的模型。

也可以在运行中的工作台里配置（接口，本轮没有界面入口）：

- `config.save`：`{expectedRevision, value:{kind:'provider', providerId, baseUrl, api, apiKey, models[]}}` 保存 provider（密钥写入上面这个文件，库里只记引用）；`{expectedRevision, value:{kind:'model', providerId, modelId}, roleId}` 或带 `projectId` 给角色/项目指定模型。
- `config.get`：读当前生效配置与已配置的 provider（只回引用与"是否已配置"）。
- `config.test`：真实试连一次，返回该选择的可用性与失败原因。
- 保存 provider 后运行时会立即重载，下一次被认领的输入即可使用；已经开始的工作保持原配置。

**凭证边界（如实说明）**：模型的文件工具被拒绝访问服务器私有目录（数据目录、凭证文件、数据库与会话历史），因此这些内容不会进入对话。两个由此而来的限制：Agent 的 `bash` 与操作者同权限，刻意绕过的命令仍可读到本机可读的任何文件（需要更强保证时应给命令执行加操作系统级沙箱，尚未实现）；也**不要**把项目目录放在数据目录里面——那样整个项目的文件工具都会被拒绝（守卫只认“在私有目录内”，不区分用途）。 守卫的路径归一化只覆盖 POSIX 形态（`@`、`~/`、`file://`），Windows 专有的盘符/反斜杠写法不在内——本工作台当前只在 POSIX 上部署运行。

快速自检（不启动工作台，直接用真实模型跑一次往返，并验证模型会调用提问工具）：

```bash
cd devagent
cp config/model.example.json config/model.json   # 首次：填 provider/model/endpoint
npm run check:model
npm run check:runtime
npm run check:workflow        # 约 3–5 分钟；无浏览器，提问按“同意”自动答复
```

`config/model.json` 只给这个检查脚本用，服务端不读它；它已被 `.gitignore` 忽略。

## 4. 数据目录里有什么

```
<dataDir>/state.db                 SQLite：项目、会话、输入、任务、结果、需求索引、交互
<dataDir>/sessions/*.jsonl         Pi 原生会话历史（每会话一个文件）
<dataDir>/models.json, auth.json   模型凭证
<dataDir>/attachments/<sha256>     会话图片（上传的与工具截图的字节，内容寻址）
<dataDir>/work/<sessionId>/web/   web_fetch 落盘的网页正文（可用 grep/read 精读）
```

项目文件本身**不在**数据目录里：项目是你选择的工作台运行环境中的既有目录，工作台只记录它的路径与其归属，不会把它复制进来。

## 5. 备份与恢复

备份 = 复制数据目录；恢复 = 放回同一路径后按第 2 节启动。

```bash
# 备份（工作台可以先停掉，停掉最干净）
tar -czf agentdev-backup-$(date +%Y%m%d).tgz -C <dataDir 的上一级> <dataDir 名>

# 恢复
mkdir -p <dataDir 的上一级>
tar -xzf agentdev-backup-YYYYMMDD.tgz -C <dataDir 的上一级>
# 然后按第 2 节用同一个 AGENTDEV_DATA_DIR 启动
```

恢复后应能看到原来的项目、会话、需求、任务与报告；`sessions/*.jsonl` 决定会话能否原生续办，两者要一起备份。项目目录本身按你自己的方式备份（工作台不代管）。模型凭证含明文 key，备份件要按密钥对待。

## 6. 常用命令

```bash
npm test                      # 单元与集成测试（不含浏览器）
npm run build                 # 构建浏览器外壳（webapp → web-static，服务端在 / 托管）
npx playwright test           # 浏览器验收（真实 Chromium + 真实服务进程，使用 stub 模型端点）
npm run check:model           # 真实模型往返检查（需 config/model.json）
npm run check:runtime         # 真实模型跑通一次输入执行与落盘
npm run check:workflow        # 真实模型跑完整 Task 流程（开发→审核→测试→结算→结束）
npm run check:tools           # 真实模型跑三项外部工具与图片输入（web_search/web_fetch/browser）
npm run check:prompts         # 角色提示文件与链接检查
```
