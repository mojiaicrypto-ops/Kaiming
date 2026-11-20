<div align="center">

# Kaiming · 开明

**Self-Hosted Engineering Workbench for Continuous AI Coding-Agent Delivery**

Turn one-off AI chats into a disciplined engineering loop: **Spec → Plan → Develop → Independent Review → Independent Test → Document Settlement**.  
So AI doesn't just write code—it finishes the job, updates project memory, and lets you pick up right where you left off.

[简体中文](README.md) | **English** · [Quick Start](#-quick-start) · [How It Works](#-how-it-works) · [Architecture](#-architecture) · [Install & Ops](docs/install.en.md) · [Docs Index](docs/INDEX.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-24_LTS-339933?logo=node.js&logoColor=white)](docs/install.en.md)
[![Runtime](https://img.shields.io/badge/Runtime-Resident_Server_%2B_SQLite-003B57?logo=sqlite&logoColor=white)](#4-resident-server--honest-recovery)
[![Protocol](https://img.shields.io/badge/MCP-stdio_%2B_HTTP-6E56CF)](#5-dual-entry-points-web-workbench--external-agents-mcp)

</div>

---

<div align="center">

![Kaiming 70s Product Walkthrough: From Single-Chat Chaos to Disciplined Engineering Delivery](docs/assets/kaiming-intro.en.gif)

<sub>🎬 <b>70s Animated Product Walkthrough</b> (HD MP4 Video: <a href="docs/assets/kaiming-intro.en.mp4">docs/assets/kaiming-intro.en.mp4</a> · Hand-drawn Architecture Overview: <a href="docs/assets/kaiming-overview-gpt-image.en-v3.png">PNG</a> / <a href="docs/assets/kaiming-overview.en.svg">Vector SVG</a>)</sub>

</div>

---

## 💡 Why Kaiming?

Modern AI coding agents can already write great code, yet most tools default to stuffing everything into **one ever-growing chat transcript**. When you drive a real software project across multiple days and iterations, the structural flaws of a single long chat surface—and a larger context window does not fix them:

| Failure Mode of a Single Long Chat | Kaiming's Engineering Guardrail |
| :--- | :--- |
| **Context Drift**: Earlier decisions get compressed away or confidently misremembered later in the thread | **Facts on Disk (`.dev/`)**: Specs, Plans, backlog items, and reports live as real project files; each new Session assembles current documents on demand instead of inheriting drifted chat memory |
| **Grading Its Own Homework**: The same agent writes the code and declares "all checks passed" in one context | **Structural Independence**: Review and Test run in fresh, isolated Sessions that inspect real files, Git diffs, and runtime evidence—**they never read the developer's chat transcript** |
| **Scope Creep & Shortcuts**: Silently editing unrelated files or skipping design/testing to show quick output | **Read-Only Chief + Host Hard Gates**: The Chief has no file-write or arbitrary shell-write permissions and must create a Task to dispatch specialists; the host verifies delivery snapshots, review coverage, and Git commits before closing |
| **Tab Closed = Progress Lost**: Refreshing the browser or losing network drops the run, with no clear way to resume | **Resident Server + Fact-Based Recovery**: Execution is decoupled from viewing; Tasks keep running when the browser closes, and restarts reconcile SQLite state against actual files on disk without replaying unknown side effects |
| **Amnesia After Delivery**: Code changes land, but specs and backlog stay stale—forcing the next session to start from scratch | **Mandatory Settlement (`settler`)**: Every Task finishes by updating spec implementation status, closing delivered backlog items, archiving reports, and committing to Git |

---

## ✨ How It Works

Kaiming is neither an autocomplete plugin nor a rigid workflow DSL. It connects your local repositories to a **self-hosted resident workbench** designed around three outcomes: **the work gets done, the project remembers, and you can always pick up next time**.

### 1. Two-Track Collaboration: Free Exploration vs. Controlled Delivery

You always collaborate with a **Chief** agent, with an explicit authorization boundary between discussion and execution:

```text
[Track A: Exploration & Planning]  Free Discussion / Investigation ──("Record this")──► .dev/backlog.md (Backlog)
                                                                   ──("Design first")─► Design Task (Module Map + Specs + Slices, confirmed by you)

[Track B: Controlled Delivery]     "Implement B-12" or a direct delivery goal
                                    └──► Implementation Task: Overall Plan (Verification Profile + Acceptance)
                                         ├── 1. Develop (Developer Session)  → Write code & focused self-checks
                                         ├── 2. Review  (Reviewer Session)   → Isolated context checks specs, invariants & negative controls
                                         ├── 3. Test    (Tester Session)     → Isolated context runs real tests & browser/API verification
                                         └── 4. Settle  (Settler Session)    → Updates spec state, closes backlog, writes settlement & Git commit
```

- **No Unsolicited Scope Expansion**: Nothing is added to the backlog unless you ask to record it; no code is changed unless you authorize implementation.
- **Bounded Verification Profiles**: Every code or UI Plan declares an explicit verification profile (`visual` for copy/pure styling, `focused` as an upper bound for local behavior changes, or `broad` for shared contracts), preventing both under-testing and runaway full-suite noise on small changes.

### 2. Role-Isolated Contexts & Multi-Model Assignment

Kaiming provides 6 specialist roles under the Chief. **Each role runs in its own isolated Session history with strict tool boundaries and an independently configurable model**:

| Role | Responsibility & Deliverable | Context & Permission Boundary |
| :--- | :--- | :--- |
| **Chief (`chief`)** | Collaborates with the user, clarifies goals, authors the Task Plan, orchestrates phases | Read-only file access + allowlisted read-only Git inspector (`inspect`); **no file-write or write-shell access** |
| **Investigator (`investigator`)** | Explores the codebase, diagnoses root causes, maps current behavior | Read-only toolset; produces structured investigation reports |
| **Designer (`designer`)** | Authors/updates product specs (`.dev/product/`) and technical designs (`.dev/technical/`), splits ready backlog slices | Writes only spec and design documents within a Design Task |
| **Developer (`developer`)** | Implements code per Plan and specs, runs focused unit/TDD checks | Full project file read/write, test execution, browser tools, and `codemode` |
| **Reviewer (`reviewer`)** | Performs falsification-oriented code & spec review (`passed` / `needs_fix`) | **Isolated Session; never reads developer chat**; binds every changed deliverable file |
| **Tester (`tester`)** | Runs independent verification (including mandatory falsifiable Negative Controls) | **Isolated Session; never reads developer chat**; verifies via real execution and browser evidence |
| **Settler (`settler`)** | Updates spec implementation status, closes delivered backlog items, writes settlement report, creates Git commit | Single writer for documentation close-out and version control |

> **Mix and Match Models per Role**: Assign a strong reasoning planner to `chief` / `designer`, a fast coding model to `developer`, and a different vendor's model to `reviewer`—eliminating blind spots across both context and model families.

### 3. Documents as Durable Project Memory (`.dev/` Layout)

Kaiming never clones or copies your repository. Instead, it maintains structured engineering memory directly inside your project directory:

```text
your-project/
├── .dev/
│   ├── backlog.md                  # Project backlog (ready / idea / done / dropped)
│   ├── product/                    # Product specs (module map, behavior contracts, acceptance, implementation state)
│   ├── technical/                  # Technical design (architecture boundaries, interfaces, verification entry points)
│   └── work/<taskId>/              # Full traceable dossier for each Task
│       ├── plan.md                 # Overall Plan (goal, scope, verification profile, acceptance criteria)
│       └── <sessionId>/            # Formal specialist reports and settlement.md
└── src/                            # Your actual project source code
```

When you open a new session days later, agents load the current module map, spec implementation state, and backlog from `.dev/` on demand—no need to re-explain your architecture.

### 4. Resident Server & Honest Recovery

- **Closing the Browser ≠ Stopping Work**: The browser is purely an observation and control client. The resident Node.js Server continues driving Tasks in the background; reconnect anytime to inspect progress or answer pending agent questions.
- **Honest Crash Recovery**: After a server restart, completed phases, Session histories, and user decisions remain intact. In-flight operations whose boundary cannot be confirmed are honestly marked `interrupted` for verification—never faked as successful or blindly replayed.
- **Dirty-Workspace Baseline Isolation**: When a Task starts, Kaiming snapshots pre-existing uncommitted files (`dirtyBaseline`) so unrelated local edits neither pollute delivery checks nor get wiped by cleanup gates.

### 5. Dual Entry Points: Web Workbench & External Agents (MCP)

Alongside the built-in Web Workbench (5-column project board, live terminal stream, unified `FileViewer` canvas for files and reports, per-role model & thinking-level settings, token usage analytics), Kaiming natively exposes **stdio MCP** and a resident **`/mcp` HTTP endpoint**:

- Delegate tasks to Kaiming directly from **Claude Code, Codex, Cursor, Antigravity**, or any MCP-capable coding assistant;
- External MCP delegations share the **exact same resident Server, SQLite source of truth, fixed project session, and delivery gates** as the browser UI—kick off work from your CLI and watch the phases, reviews, and reports live in the browser.

---

## 🏗️ Architecture

```text
  Browser Web Workbench ─── HTTP / SSE ───┐
  (Board / Chat Stream / FileViewer)      │
                                          ▼
  External Coding Agents ── stdio / /mcp ─► Resident Node.js Server (Single instance, multi-project)
  (Codex / Claude Code / ...)             │
                                          ├── SQLite WAL (Projects, Sessions, Tasks, Phases, Interactions, Reports)
                                          ├── Pi Native Session History (Isolated Session JSONL + Role Toolsets)
                                          ├── Host Completion Gates (Plan Contract, Dirty Baseline, Review Binding, Git Check)
                                          └── Your Local Project Directories (Worked on in-place, never copied)
```

---

## 🚀 Quick Start

### 1. Requirements

- **OS**: macOS or Linux (POSIX)
- **Node.js**: **24 LTS** (`24.22.1+` recommended; uses built-in `node:sqlite`—no Docker or external database required)
- **Model Endpoint**: Any OpenAI-compatible API, Anthropic API, or local model server (OpenAI, Claude, DeepSeek, etc.)

### 2. One-Command Setup & Launch

```bash
git clone <repository-url>
cd <repository-directory>

./scripts/setup.sh
./scripts/start.sh
```

`setup.sh` installs server and webapp dependencies, builds the static frontend (`kaiming/web-static`), generates a random access password in `kaiming/.env` (mode `600`, gitignored), and prints the local URL and login password.

### 3. Sign In & Configure Models

1. Open **`http://127.0.0.1:4173`** in your browser and sign in with the printed password (also stored as `KAIMING_ACCESS_PASSWORD` in `kaiming/.env`).
2. Go to **Settings → Models**, add your model provider (Base URL, API protocol, API Key, and Model ID), and select a default model. You can also assign distinct models and thinking levels per specialist role.
3. Open your local project directory and start collaborating with the Chief.

---

## 🛠️ Everyday Operations & MCP Setup

### Common Commands

```bash
# Start the resident Server (use tmux, systemd, or launchd for long-running background service)
./scripts/start.sh

# Back up runtime data (stop the server first; treat the archive as a secret since it holds credentials)
tar -czf kaiming-backup-$(date +%Y%m%d).tgz -C kaiming .kaiming-data

# Upgrade (preserves existing .env and .kaiming-data; schema migrations run automatically on startup)
git pull && ./scripts/setup.sh && ./scripts/start.sh
```

### Connect Claude Code / Codex via MCP

Add `kaiming` to your MCP client configuration:

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

> The `stdio` process attaches to an already-running Kaiming Server first, or boots one if none is active. For environment variables, multi-project `/mcp` HTTP setup, and troubleshooting, see **[Installation & Operations](docs/install.en.md)** and **[MCP Service Contract (Chinese)](docs/technicalnew/mcp-service.md)**.

---

## 🔒 Security & Scope Boundaries

- **Localhost by Default**: Listens only on `127.0.0.1:4173` out of the box. If you expose it remotely, put it behind a reverse proxy with HTTPS and access control.
- **Role Isolation & Destructive-Command Confirmation**: File tools are strictly jailed to the active project directory (the workbench's private data directory is off-limits); the Chief has no file-write or write-shell access; specialist destructive shell commands (`rm`, `git reset --hard`, etc.) require explicit user confirmation in the browser.
- **Not an OS Sandbox**: Specialist `bash` runs with the permissions of the OS user that launched Kaiming. Do not run untrusted third-party repositories without OS/container isolation.
- **Focused Single-User Workbench**: Built for individual developers and hands-on technical leads. Multi-tenant SaaS, team RBAC, and automated production deployment pipelines are out of scope.

---

## 📚 Documentation & Development

| Document | Description |
| :--- | :--- |
| **[Installation & Operations (`docs/install.en.md`)](docs/install.en.md)** | Requirements, manual setup, model configuration, env vars, backup/restore, and troubleshooting |
| **[Documentation Index (`docs/INDEX.md`)](docs/INDEX.md)** | Entry point to all product requirements, technical contracts, verified baseline, and roadmap (Chinese) |
| **[Product Overview (`docs/productnew/README.md`)](docs/productnew/README.md)** | The six business modules, core domain model, and end-to-end delivery lifecycle (Chinese) |
| **[User Journeys (`docs/productnew/journeys.md`)](docs/productnew/journeys.md)** | Greenfield setup, existing-repo onboarding, design slicing, delivery, and MCP delegation flows (Chinese) |
| **[Technical Design (`docs/technicalnew/README.md`)](docs/technicalnew/README.md)** | Architecture diagrams, role & tool contracts, runtime recovery, and UI contracts (Chinese) |
| **[Development Rules (`AGENTS.md`)](AGENTS.md)** | Contributor workflow, verification profiles (`visual` / `focused` / `broad`), and settlement lessons |

### Local Development & Verification

```bash
cd kaiming
npm ci && npm --prefix webapp ci
npm run build

npm test                         # Server unit & integration suite
npm --prefix webapp test         # Frontend component & state suite
npm run typecheck                # Server TypeScript check
npm --prefix webapp run typecheck
npm run test:browser             # Playwright real Chromium + real server E2E suite
```

---

## 📄 License

Released under the [MIT License](LICENSE). Free for personal and commercial use, modification, and distribution with copyright and license notices retained.
