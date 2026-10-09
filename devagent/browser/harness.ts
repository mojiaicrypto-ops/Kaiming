/**
 * Real-browser acceptance harness (P4-i): the same server the operator runs, started in-process with
 * a throwaway data directory and project, plus helpers to log in through the UI and to seed real
 * rows through the same RPC surface the browser uses.
 *
 * Nothing here is mocked: the browser talks to `startWorkbench` over HTTP, and the seed calls go
 * through `POST /api/v1/rpc` exactly like the page does (cookie for reads, CSRF for writes).
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { startWorkbench } from '../src/server/main.ts';
import { createStubEnv, startStubModelServer, type StubReply } from '../spikes/harness/pi-env.ts';

const RPC_PATH = '/api/v1/rpc';
const CSRF_HEADER = 'x-agentdev-csrf';

/** localStorage keys the browser bootstrap (`web/app.js`) reads on boot. */
export const STORAGE_KEYS = {
  projectPath: 'agentdev.projectPath',
  sessionId: 'agentdev.sessionId',
  language: 'agentdev.language',
} as const;

interface RpcSession {
  readonly cookie: string;
  readonly csrfToken: string;
}

export interface SeededProject {
  readonly projectId: string;
  readonly sessionId: string;
  /** The realpath the server registered; what the browser must open to reach the same project. */
  readonly projectPath: string;
}

export interface Harness {
  readonly baseUrl: string;
  readonly accessPassword: string;
  /** The seeded project, or null when the run models a first-time user with no project yet. */
  readonly project: SeededProject | null;
  /** The absolute URL a spec navigates to (the port is dynamic). */
  readonly url: string;
  close(): Promise<void>;
}

interface RpcResponse {
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

/** One RPC envelope, the same shape the page sends: `{ requestId, method, params }`. */
async function rpc(
  baseUrl: string,
  session: RpcSession | undefined,
  method: string,
  params: Record<string, unknown>,
  requestId: string = `seed-${randomUUID()}`,
): Promise<unknown> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (session !== undefined) {
    headers['cookie'] = session.cookie;
    headers[CSRF_HEADER] = session.csrfToken;
  }
  const response = await fetch(`${baseUrl}${RPC_PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ requestId, method, params }),
  });
  const body = (await response.json()) as RpcResponse;
  if (body.error !== undefined) {
    throw new Error(`seed ${method} failed: ${body.error.code} ${body.error.message}`);
  }
  return body.result;
}

/** Exchange the access password for a session cookie + CSRF token, as the login dialog does. */
async function login(baseUrl: string, accessPassword: string): Promise<RpcSession> {
  const response = await fetch(`${baseUrl}${RPC_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: `seed-login-${randomUUID()}`,
      method: 'auth.login',
      params: { password: accessPassword },
    }),
  });
  const body = (await response.json()) as RpcResponse & { result?: { csrfToken?: string } };
  if (body.error !== undefined) {
    throw new Error(`seed login failed: ${body.error.code} ${body.error.message}`);
  }
  const csrfToken = body.result?.csrfToken;
  if (csrfToken === undefined) {
    throw new Error('seed login returned no csrfToken');
  }
  const cookie = (response.headers.getSetCookie()[0] ?? '').split(';')[0] ?? '';
  if (cookie === '') {
    throw new Error('seed login returned no session cookie');
  }
  return { cookie, csrfToken };
}

/**
 * Register a project and open one chief session through the RPC API (fetch). Returns the realpath so
 * the browser opens the same project row rather than registering a second copy.
 */
export async function seedProjectSession(
  baseUrl: string,
  accessPassword: string,
  projectDir: string,
): Promise<SeededProject> {
  const session = await login(baseUrl, accessPassword);
  const opened = (await rpc(baseUrl, session, 'project.open', { path: projectDir })) as {
    readonly project: { readonly projectId: string; readonly realPath: string };
  };
  const created = (await rpc(baseUrl, session, 'session.create', {
    projectId: opened.project.projectId,
  })) as { readonly session: { readonly sessionId: string } };
  return {
    projectId: opened.project.projectId,
    sessionId: created.session.sessionId,
    projectPath: opened.project.realPath,
  };
}

/**
 * Start the real workbench with a temp data dir, seed a project + session unless `seedProject` is
 * false, and hand back the origin plus the access password so a test can log in through the UI.
 */
export async function startHarness(
  options: { readonly seedProject?: boolean; readonly model?: readonly StubReply[] } = {},
): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'devagent-browser-'));
  const dataDir = join(root, 'data');
  const projectDir = join(root, 'project');
  mkdirSync(projectDir, { recursive: true });
  const accessPassword = randomBytes(18).toString('base64url');
  // A scripted model endpoint: the acceptance run needs a real run, not a mock of our own protocol.
  const modelServer =
    options.model === undefined || options.model.length === 0 ? undefined : await startStubModelServer(options.model);
  const stubEnv = modelServer === undefined ? undefined : await createStubEnv(modelServer.baseUrl);
  const running = await startWorkbench({
    dataDir,
    accessPassword,
    port: 0,
    ...(stubEnv === undefined ? {} : { agentDir: stubEnv.agentDir }),
    ...(modelServer === undefined ? {} : { model: { providerId: 'stub', modelId: 'stub-1' } }),
  });

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    await running.close();
    await modelServer?.close();
    rmSync(root, { recursive: true, force: true });
  };

  try {
    const project =
      options.seedProject === false
        ? null
        : await seedProjectSession(running.origin, accessPassword, realpathSync(projectDir));
    return { baseUrl: running.origin, url: `${running.origin}/`, accessPassword, project, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/**
 * Log in through the real login dialog (`#appDialog` opened by `web/app.js`), the same way a person
 * does; the dialog closes only when the server accepted the password.
 */
export async function loginThroughUi(page: Page, accessPassword: string): Promise<void> {
  const input = page.locator('#appDialog #accessPassword');
  await input.waitFor({ state: 'visible' });
  await input.fill(accessPassword);
  await page.locator('#appDialog .dialog-actions button.primary').click();
  await expect(page.locator('#appDialog')).not.toBeVisible();
}
