<div align="center">

# 开明 · Kaiming

**面向 AI 编码 Agent 持续交付的自托管研发工作台**

把单次对话变成「规格 → 计划 → 开发 → 独立审核 → 独立测试 → 文档结算」的完整工程闭环。  
让 AI 不只是会写代码，而是能把项目做完、记住、并在下一次无缝接上。

**简体中文** | [English](README.en.md) · [快速开始](#-快速开始) · [核心工作方式](#-核心工作方式) · [架构设计](#-系统架构) · [安装与运维](docs/install.md) · [文档索引](docs/INDEX.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-24_LTS-339933?logo=node.js&logoColor=white)](docs/install.md)
[![Runtime](https://img.shields.io/badge/Runtime-Resident_Server_%2B_SQLite-003B57?logo=sqlite&logoColor=white)](#4-常驻-server-与断点接续)
[![Protocol](https://img.shields.io/badge/MCP-stdio_%2B_HTTP-6E56CF)](#5-浏览器与外部-agent-双入口mcp)

</div>

---

<div align="center">

![开明 70 秒产品动态介绍：从单次长聊天到受控工程交付](docs/assets/kaiming-intro.zh.gif)

<sub>🎬 <b>70 秒动态演示</b>（高清 MP4 视频版：<a href="docs/assets/kaiming-intro.zh.mp4">docs/assets/kaiming-intro.zh.mp4</a> · 手绘架构全景图：<a href="docs/assets/kaiming-overview-gpt-image.zh-v3.png">PNG</a> / <a href="docs/assets/kaiming-overview.zh.svg">矢量 SVG</a>）</sub>

</div>

---

## 💡 为什么需要开明？

今天的 AI 编码工具已经能写出好代码，但默认把一切塞进**一个越来越长的聊天窗口**。当你要持续推进一个真实软件项目时，单次长聊天的固有缺陷就会暴露——换更大的上下文窗口也无法消除：

| 单次长聊天的常见失控 | 开明（Kaiming）的工程化防线 |
| :--- | :--- |
| **上下文漂移**：聊到后面忘记早期约定，甚至自信地编造做过的决定 | **事实落盘（`.dev/`）**：规格、Plan、待办与报告全部落为项目文件；新 Session 按需装配当前文档，不靠聊天记忆传话 |
| **既当运动员又当裁判**：同一个上下文里写完代码自己说“检查通过” | **结构化独立审查**：审核（Review）与测试（Test）在全新的独立 Session 中运行，只读真实文件、Git 改动与运行证据，**绝不读取开发的聊天自评** |
| **范围失控与偷跑**：顺手改无关文件，或跳过设计/测试直接宣称完成 | **审计的主管 Shell + 宿主硬门禁**：主管（Chief）有观察/运维 shell、无 write/edit，每次调用后宿主审计 HEAD 与工作区；项目交付改动必须建 Task 派发专业角色，宿主在结束时核对交付快照、审查覆盖与 Git 提交 |
| **关页面即断联**：刷新浏览器或断网就丢进度，重启后不知做到哪 | **常驻 Server + 事实恢复**：执行与查看分离；关闭浏览器任务继续跑，进程重启基于 SQLite 与磁盘实际文件恢复，不重放未知副作用 |
| **交付即失忆**：代码改完了，文档和待办留在旧状态，下次从零讲起 | **强制结算回写（Settle）**：每个 Task 收尾必须由结算角色更新规格实现状态、关闭已完成待办并归档报告，让项目拥有持久记忆 |

---

## ✨ 核心工作方式

开明不是代码补全插件，也不是固定死板的流程图 DSL。它把你的本地项目接入一个**自托管常驻工作台**，提供三个核心交付结果：**事情做完、项目记住、下次接得上**。

### 1. 双轨协作：自由讨论 vs 受控交付

在开明中，你始终与一个**主管（Chief）**对话，但探讨和动手之间有明确的授权边界：

```text
[轨道 A：探索与规划]  自由讨论 / 架构调研 ──(你说“记下来”)──► .dev/backlog.md（待办清单）
                                           ──(你说“先设计”)──► 设计 Task（模块地图 + 规格 + 切片清单，经你确认）

[轨道 B：受控工程交付] 你说“实施 B-12”或给出明确开发目标
                       └──► 实现 Task：总体 Plan（含验证档与验收点）
                            ├── 1. 开发（Developer Session）   → 编写代码与自测
                            ├── 2. 审核（Reviewer Session）    → 独立上下文核对规格、不变量与负向控制
                            ├── 3. 测试（Tester Session）      → 独立上下文执行真实测试与浏览器/接口验证
                            └── 4. 结算（Settler Session）     → 回写规格状态、关闭待办、归档报告并执行 Git 提交
```

- **不轻易越界**：你没说“记下来”不建待办；你没说“实施”不改代码。
- **按档位精准验证**：每个代码或界面 Plan 显式声明验证档位（`visual` 视觉文案 / `focused` 局部行为上限 / `broad` 跨模块契约），既防止漏测，也杜绝局部小改跑全量测试导致范围蔓延。

### 2. 多角色独立上下文与多模型分工

工作台内置 6 类专业角色，**每个角色拥有独立的会话历史、工具权限边界与可单独指定的模型**：

| 角色 | 职责与产出 | 上下文与权限边界 |
| :--- | :--- | :--- |
| **主管 (`chief`)** | 与用户协作、澄清目标、制定 Task Plan、调度阶段 | read/grep/find/ls + `bash`（观察/运维，事后审计）+ 受控只读 Git 探查（`inspect`），**无 write/edit**；追踪文件改动走 Task |
| **调查 (`investigator`)** | 只读代码库探查、定位根因、梳理现状 | 只读工具集，产出结构化调查报告 |
| **设计 (`designer`)** | 编写/更新产品规格（`.dev/product/`）与技术设计（`.dev/technical/`），拆分就绪待办切片 | 仅在设计 Task 中写入规格与设计文档 |
| **开发 (`developer`)** | 按 Plan 与规格实现代码、运行聚焦单测与局部自检 | 完整文件读写、测试运行、浏览器与 `codemode` 能力 |
| **审核 (`reviewer`)** | 对照规格与验收标准做证伪式代码审查（`passed` / `needs_fix`） | **独立 Session，不读开发聊天**；核查交付范围内每一个变更文件 |
| **测试 (`tester`)** | 编写/运行独立验证（含必须按预期失败的负向控制 Negative Control） | **独立 Session，不读开发聊天**；基于真实运行与浏览器证据判定的独立验收 |
| **结算 (`settler`)** | 更新规格实现状态、关闭本次交付的待办、落盘结算报告并完成 Git 提交 | 单点收口文档一致性与版本控制 |

> **支持按角色混搭模型**：你可以让擅长规划的模型当 `chief` / `designer`，让编码快的模型当 `developer`，再用另一个品牌的强推理模型当 `reviewer`，从结构与模型两个维度消除盲区。

### 3. 文档即项目记忆（`.dev/` 知识布局）

开明不复制你的代码库，而是在你的项目根目录下维护一套结构化的工程记忆：

```text
your-project/
├── .dev/
│   ├── backlog.md                  # 待办清单（ready 就绪 / idea 想法 / done 已完成 / dropped 已放弃）
│   ├── product/                    # 产品规格（模块地图、行为契约、验收要点与当前实现状态）
│   ├── technical/                  # 技术设计（架构边界、接口契约、验证与运行说明）
│   └── work/<taskId>/              # 每次 Task 的完整可追溯档案
│       ├── plan.md                 # 总体计划（目标、范围、验证档位、验收标准）
│       └── <sessionId>/            # 各专业角色提交的正式报告与 settlement.md
└── src/                            # 你的真实项目源码
```

下次打开新会话时，Agent 直接从 `.dev/` 读取最新模块地图、规格实现状态与待办，无需你把项目背景重讲一遍。

### 4. 常驻 Server 与断点接续

- **关掉浏览器 ≠ 停止工作**：浏览器只是观察与控制客户端；常驻 Node.js Server 在后台持续推进 Task。你可以关掉页面去喝咖啡，随时回来查看进度或回答 Agent 提出的决策问题。
- **诚实的故障恢复**：Server 重启后保留所有已完成阶段、Session 历史与用户决定；对崩溃瞬间无法确认边界的操作诚实标记为 `interrupted` 待核实，绝不伪造成功或盲目重放未知副作用。
- **脏工作区基线隔离**：Task 创建时自动记录工作区已有的未提交基线（Dirty Baseline），不让外部遗留改动污染本次交付校验，也绝不粗暴清理你的本地环境。

### 5. 浏览器与外部 Agent 双入口（MCP）

除了自带的 Web 工作台（五列项目看板、实时终端流、统一文件/报告查看画布 `FileViewer`、分层模型与思考等级配置、Token 用量统计），开明原生提供 **stdio MCP** 与常驻 **`/mcp` HTTP 端点**：

- 你在 **Claude Code、Codex、Cursor、Antigravity** 等外部编码助手里，可以通过 MCP 直接把任务委派给开明；
- 外部 Agent 委派的工作与浏览器共享**同一个 Server、同一个 SQLite 事实源、同一条项目固定会话和同一套交付门禁**；你在终端发起，打开浏览器就能实时看到看板进度与审查报告。

---

## 🏗️ 系统架构

```text
  浏览器 Web 工作台 ─── HTTP / SSE ───┐
  (看板 / 对话流 / 文件画布 / 设置)    │
                                     ▼
  外部编码 Agent ──── stdio / /mcp ──► 常驻 Node.js Server（单实例管多项目）
  (Codex / Claude Code / ...)        │
                                     ├── SQLite WAL（项目、会话、Task、阶段、交互、报告账本）
                                     ├── Pi 原生会话历史（独立 Session JSONL + 分角色工具集）
                                     ├── 宿主完成门禁（计划契约、脏基线隔离、审查文件绑定、Git 提交核对）
                                     └── 你的本地项目目录（直接就地工作，不克隆副本）
```

---

## 🚀 快速开始

### 1. 环境要求

- **操作系统**：macOS 或 Linux（POSIX）
- **Node.js**：**24 LTS**（推荐 `24.22.1+`，内置 `node:sqlite`，无需安装 Docker 或外部数据库）
- **模型服务**：任意 OpenAI 兼容端点、Anthropic API 或本地模型服务（DeepSeek、OpenAI、Claude 等）

### 2. 一键安装与启动

```bash
git clone <repository-url>
cd <repository-directory>

./scripts/setup.sh
./scripts/start.sh
```

`setup.sh` 会自动安装服务端与前端依赖、构建 Web 静态产物（`kaiming/web-static`），并在数据目录的 `.env`（新装为 `kaiming/.kaiming-data/.env`；旧 `kaiming/.env` 兼容）中生成随机访问口令（权限 `600`）后打印登录地址和口令。

### 3. 登录与配置模型

1. 浏览器打开 **`http://127.0.0.1:4173`**，输入终端打印的访问口令（也可在实际加载的 `.env` 中查看 `KAIMING_ACCESS_PASSWORD`）。
2. 进入右上角 **Settings → Models**，添加模型服务商（Base URL、协议类型、API Key 与模型 ID）并设为默认模型；你也可以按角色分别指定不同模型与思考等级。
3. 选择或接入你的本地项目目录，即可与主管开始对话。

---

## 🛠️ 日常运维与外部接入

### 常用命令

```bash
# 启动常驻服务（生产或个人长期运行建议配合 tmux / systemd / launchd 托管）
./scripts/start.sh

# 备份运行数据（停服后打包 SQLite、会话历史与模型配置，请按密钥级别妥善保管）
tar -czf kaiming-backup-$(date +%Y%m%d).tgz -C kaiming .kaiming-data

# 升级工作台（保留已有 .env 和 .kaiming-data，启动时自动迁移 schema）
git pull && ./scripts/setup.sh && ./scripts/start.sh
```

### 接入 Claude Code / Codex（MCP 配置示例）

在你的 MCP 客户端配置文件中添加 `kaiming`：

```json
{
  "mcpServers": {
    "kaiming": {
      "command": "node",
      "args": ["/absolute/path/to/repo/kaiming/src/mcp/main.ts"],
      "env": {
        "KAIMING_ACCESS_PASSWORD": "<与数据目录 .env 或旧 kaiming/.env 一致的口令>",
        "KAIMING_DATA_DIR": "/absolute/path/to/repo/kaiming/.kaiming-data",
        "KAIMING_MCP_PROJECT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

> `stdio` 进程会优先附着到已运行的开明 Server；完整环境变量、多项目 `/mcp` 端点及故障排查请查阅 **[安装与启动指南](docs/install.md)** 与 **[MCP 服务契约](docs/technicalnew/mcp-service.md)**。

---

## 🔒 安全与使用边界

- **本地回环默认保护**：默认仅监听 `127.0.0.1:4173`。如需远程访问，请务必自行配置反向代理、HTTPS 与访问控制。
- **OS 执行沙箱默认开启**：`KAIMING_SANDBOX=auto|strict|off`（默认 `auto`，重启生效）。`auto`/`strict` 缺后端或启动探针失败时拒绝执行 `bash`，不静默降级；只有显式 `off` 允许无沙箱执行并在当前工作/会话详情标「保护已关闭」。主管的项目与 `.git` 只读；设计/开发/测试工作区可写、`.git` 只读；结算可写 `.git`、hooks 只读；审核/调查/read Task 无 bash。工作台私有存储与实际加载的 `.env` 均被内核屏蔽。
- **沙箱边界**：`auto` 放行 Docker socket，`strict` 禁止；两者都保留网络与 SSH agent，因此这是本机文件系统边界，不是恶意代码隔离。项目自身 `.env`、home 下其他密钥、Docker 挂载与远端副作用不在此保护范围；不可信仓库请使用容器/VM/独立用户。主管的 HEAD/status 审计只保留可见性，不再作为主要边界。
- **高危确认**：主管处于生效只读沙箱时，提交、历史改写与工作区丢弃直接拒绝并指向结算角色；只有 `off` 模式保留原确认。真正删除文件的专业命令仍按会话确认，`Trust all` 只免确认、不解锁内核权限。
- **专注个人与单负责人深度交付**：当前定位为单用户自托管工作台，不包含多租户 SaaS、团队 RBAC 或自动化生产发布流水线。

---

## 📚 文档与开发指南

| 文档入口 | 内容说明 |
| :--- | :--- |
| **[安装与启动 (`docs/install.md`)](docs/install.md)** | 环境要求、手动安装、模型配置、环境变量、备份恢复与故障排查 |
| **[文档总索引 (`docs/INDEX.md`)](docs/INDEX.md)** | 全部产品需求、技术架构契约、当前已交付基线与下一轮路线图入口 |
| **[产品总览 (`docs/productnew/README.md`)](docs/productnew/README.md)** | 六大业务模块定义、核心对象模型与从意图到交付的完整主线 |
| **[用户流程 (`docs/productnew/journeys.md`)](docs/productnew/journeys.md)** | 新项目起步、已有代码接入、设计切片、受控交付与外部 Agent 委派端到端流程 |
| **[技术设计 (`docs/technicalnew/README.md`)](docs/technicalnew/README.md)** | 系统架构图、角色与工具契约、运行时恢复及前后端实现契约 |
| **[开发规范 (`AGENTS.md`)](AGENTS.md)** | 参与本项目开发的流程规范、验证档位要求与实战结算教训 |

### 本地开发与测试

```bash
cd kaiming
npm ci && npm --prefix webapp ci
npm run build

npm test                         # 服务端单元与集成测试
npm --prefix webapp test         # 前端组件与状态测试
npm run typecheck                # 服务端类型检查
npm --prefix webapp run typecheck
npm run test:browser             # Playwright 真实 Chromium + 真实服务进程端到端测试
```

---

## 📄 开源许可

本项目采用 [MIT License](LICENSE) 开源许可。你可以自由使用、修改、分发和用于商业用途，只需保留版权与许可声明。
