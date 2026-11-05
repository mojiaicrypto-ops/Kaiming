# Kaiming installation and setup

[简体中文](install.md) | **English**

This page covers first deployment, upgrades and operations. For the project overview, see [README](../README.en.md).

## 1. Requirements

- macOS or Linux (POSIX); Windows is unverified.
- Node.js **24 LTS**. 24.22.1+ is recommended; earlier 24.x can run, but `officeparser` may print an engine warning.
- npm (installed with Node.js).
- A model endpoint: OpenAI-compatible, Anthropic Messages, or a local OpenAI-compatible service.
- Optional: Chromium for the agent's browser tool. Everything else works without it.

Docker is not required. Kaiming is not a global command; clone it anywhere.

## 2. Recommended install: setup script

From the repository root:

```bash
./scripts/setup.sh
./scripts/start.sh
```

`setup.sh` does four things:

1. installs dependencies in `kaiming/` and `kaiming/webapp/` (`npm ci` when a lockfile exists);
2. builds `kaiming/web-static/`;
3. creates a random access password and local configuration in `kaiming/.env` if it does not exist, with mode 600;
4. prints the URL and password.

Then open:

```text
http://127.0.0.1:4173
```

Sign in with `KAIMING_ACCESS_PASSWORD` from `kaiming/.env`.

Running `setup.sh` again does not overwrite an existing `.env`, so it does not change the password. After upgrading code, run it again to refresh dependencies and the build. Database migrations run as needed on the next start.

## 3. Manual install and start

Without the scripts:

```bash
cd kaiming

npm ci
npm --prefix webapp ci

npm run build

cp .env.example .env
chmod 600 .env
# edit .env and set a long KAIMING_ACCESS_PASSWORD

npm start
```

`npm start` is equivalent to:

```bash
node --env-file-if-exists=.env src/server/main.ts
```

Startup logs show the listening address and data directory. Without an access password the process exits; it will not start a passwordless workbench.

## 4. Configure a model

### 4.1 In the UI (recommended)

After signing in, open **Settings → Models**:

1. add a provider: name, Base URL and protocol (OpenAI chat/completions, OpenAI responses or Anthropic messages);
2. add a model id; declare reasoning support and context window when needed;
3. save the API key;
4. select a default model and test the connection.

Keys stay on the server. The Settings page never displays the secret again.

### 4.2 Through environment variables

You can set a default model in `.env`:

```dotenv
KAIMING_MODEL_PROVIDER=deepseek
KAIMING_MODEL_ID=deepseek-flash
```

Both default to `unset`. With `unset`, the workbench still starts and can read projects, sessions, requirements and history, but inputs are not executed by a model; the interface explains the missing configuration.

### 4.3 Maintain model files directly

The server passes credentials to Pi. Files in the data directory:

```text
<dataDir>/models.json     provider definitions (baseUrl / api / apiKey / models)
<dataDir>/auth.json       normally []
```

Example OpenAI-compatible endpoint:

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

`KAIMING_MODEL_PROVIDER` / `KAIMING_MODEL_ID` must match the provider and `models.id` here. If a model is unavailable, inputs remain queued with an explicit `MODEL_UNAVAILABLE` report; there is no silent fallback.

`kaiming/config/model.json` is only used by real-model check scripts such as `npm run check:model`. The server does not read it, and it is gitignored.

## 5. Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `KAIMING_ACCESS_PASSWORD` | yes | none | Browser access password; an empty value refuses startup |
| `KAIMING_DATA_DIR` | no | `./.kaiming-data` | Data directory, also the model credential directory |
| `KAIMING_HOST` | no | `127.0.0.1` | Listen address; read [Security boundaries](#9-security-boundaries) before exposing it |
| `KAIMING_PORT` | no | `4173` | Listen port |
| `KAIMING_MODEL_PROVIDER` | no | `unset` | Default model provider id |
| `KAIMING_MODEL_ID` | no | `unset` | Default model id |
| `KAIMING_RUN_STALL_MS` | no | `900000` | Abort a run with no Pi events for longer than this |
| `KAIMING_RUN_TOTAL_MS` | no | `5400000` | Maximum charged run duration; user/member wait time is excluded |
| `KAIMING_BASH_TIMEOUT_SECONDS` | no | `600` | Host default when the model gives bash no timeout; `0` disables it |

External agent access uses additional variables such as `KAIMING_MCP_URL` and `KAIMING_MCP_PROJECT`; see the [MCP service (Chinese)](technicalnew/mcp-service.md).

## 6. Data directory and installation locations

The default `KAIMING_DATA_DIR` is `.kaiming-data` under the startup directory. When started through `scripts/start.sh`, it is `kaiming/.kaiming-data`.

```text
<dataDir>/state.db                 SQLite: projects, sessions, inputs, Tasks, results, interactions
<dataDir>/sessions/*.jsonl         Pi native session history
<dataDir>/models.json, auth.json   model credentials
<dataDir>/attachments/             image and document attachments
<dataDir>/work/<sessionId>/web/    web_fetch page bodies
```

The following are **not** in the data directory:

- **Project directories**: the workbench records existing directories selected by the user and does not copy project files.
- **Browser build**: `kaiming/web-static/`, generated by `npm run build`.
- **Startup config**: `kaiming/.env`, separate from the data directory. Back it up as a secret too.

Do not put a project directory inside the data directory: the workbench treats files in private storage as inaccessible, which blocks the project tools.

## 7. Backup, restore and upgrade

### Backup

The cleanest backup is to stop the workbench and copy the data directory:

```bash
tar -czf kaiming-backup-$(date +%Y%m%d).tgz -C kaiming .kaiming-data
```

Keep `kaiming/.env` as a secret alongside it. Back up project directories separately; the workbench does not manage them.

### Restore

```bash
# stop the workbench first
tar -xzf kaiming-backup-YYYYMMDD.tgz -C kaiming
./scripts/start.sh
```

Use the same `KAIMING_DATA_DIR` as the backup. After restore you should see the original projects, sessions, requirements, Tasks and reports. `sessions/*.jsonl` determines whether native sessions can continue, so restore it together with the database.

### Upgrade

```bash
# back up first
git pull
./scripts/setup.sh
./scripts/start.sh
```

Database migrations run on startup. Do not delete the old data directory to "fix" a failed upgrade; preserve the data and error, then address the migration or version issue.

## 8. External agent access (MCP)

The workbench provides stdio MCP and a resident `/mcp` endpoint. Codex / Claude Code style clients use a stdio child-process configuration, for example:

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

Notes:

- `KAIMING_MCP_PROJECT` must be an absolute project path; the workbench does not inherit the server process cwd as an implicit project.
- The stdio process attaches to a running, responsive workbench first; only when none exists does it start one.
- The resident `/mcp` endpoint serves multiple projects, so tool calls must include `project_path` unless `KAIMING_MCP_PROJECT` is configured for the deployment.
- Authentication uses the same access password. Do not put the password in a public client configuration.

For the full tool surface, errors and verification, see the [MCP service (Chinese)](technicalnew/mcp-service.md).

## 9. Security boundaries

- By default it listens only on loopback. Exposing it to the internet requires HTTPS, a reverse proxy and access control; this is not a managed multi-tenant service.
- The access password lives in `kaiming/.env`; model keys live in the data directory or server configuration. Never commit `.env`, `config/model.json` or the data directory.
- Agent `bash` has the same permissions as the system user that started the workbench. There is no OS-level sandbox; do not run untrusted repositories or grant unnecessary privileges.
- Model file tools refuse to read server-private storage (data directory, credentials, database, session history), but a deliberate `bash` bypass still needs OS-level permission boundaries.
- Single-user by design. Team accounts, RBAC, managed hosting and automatic multi-tenant isolation are out of scope.

## 10. Troubleshooting

| Symptom | Action |
|---|---|
| `scripts/start.sh` says `.env` is missing | Run `./scripts/setup.sh`, or create `.env` manually |
| Wrong password at login | Check `grep KAIMING_ACCESS_PASSWORD kaiming/.env`; without `.env` it will not start |
| Page says the shell is not built | Run `npm --prefix kaiming run build` |
| Inputs stay queued with `MODEL_UNAVAILABLE` | Configure and test a model in Settings → Models, or check `models.json` in the data directory |
| Browser tool returns `BROWSER_UNAVAILABLE` | Run `npx playwright install chromium` in `kaiming` |
| Port already in use | Change `KAIMING_PORT` in `.env`, or stop the process using the port |
| npm prints an engine warning | Upgrade to Node 24.22.1+; earlier 24.x can still run |
| Data migration fails | Stop the service, keep the data directory and error log; do not delete old data |

## 11. Development and verification

```bash
cd kaiming
npm test
npm --prefix webapp test
npm run typecheck
npm --prefix webapp run typecheck
npm run test:browser
```

Real-model checks use a separate `config/model.json`:

```bash
cd kaiming
cp config/model.example.json config/model.json
# fill provider/model/key
npm run check:model
npm run check:runtime
npm run check:workflow
npm run check:tools
```

For delivery workflow and verification-profile requirements, see [delivery (Chinese)](productnew/modules/delivery.md) and [AGENTS.md](../AGENTS.md).
