/**
 * Runtime support for `pnpm test:e2e` (`scripts/e2e.mjs`, WP-10 T2).
 *
 * The end-to-end runner boots the **real** product — a real temporary Git project,
 * a real SQLite `ProjectStore`, the real Core services, the real `createDaemon`
 * (HTTP + WebSocket) and the real `createWebApp` BFF — from a plain Node script with
 * no new dependency and no browser.
 *
 * Two problems have to be solved for that, and this module owns both:
 *
 * 1. **Loading TypeScript sources from a `.mjs` script.** Node 24 strips TypeScript
 *    types natively, but it does not rewrite the `./x.js` specifiers the `NodeNext`
 *    sources use, and it does not resolve this workspace's `@agentdev/*` packages
 *    (the root has no dependency links). {@link installSourceResolver} registers a
 *    synchronous module hook that maps both onto a package's `src/index.ts`, so the runner
 *    executes the same sources `vitest` and `tsc` check — never a stale `dist/`.
 * 2. **Talking HTTP and WebSocket to the real stack with built-ins only.** Node's
 *    `fetch` cannot perform a WebSocket upgrade and the dependency policy forbids
 *    `ws`, so {@link httpRequest} and {@link WsClient} implement the small RFC6455
 *    subset the product already uses on both of its own sides (text frames only).
 *
 * Nothing here fakes product behaviour: it is transport, temporary-directory and Git
 * plumbing that the checks in `scripts/e2e.mjs` drive against the real daemon/BFF.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequestBase } from 'node:http';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Repository root, resolved from this file so the runner works from any cwd. */
export const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Workspace packages whose bare specifier maps onto its `src/index.ts`. */
const SOURCE_PACKAGES = [
  'contracts',
  'pi-runtime',
  'domain',
  'storage',
  'knowledge',
  'workspace',
  'core',
  'client',
];

let resolverInstalled = false;

/**
 * Maps `@agentdev/<pkg>` and `./x.js` onto the real TypeScript sources.
 *
 * `registerHooks` is Node's synchronous in-process loader hook (Node >= 22.15), so
 * the mapping applies to every subsequent dynamic import without a child process.
 * A `.js` specifier is only rewritten when the sibling `.ts` file actually exists,
 * which keeps genuine JavaScript assets untouched.
 */
export function installSourceResolver() {
  if (resolverInstalled) return;
  resolverInstalled = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@agentdev/')) {
        const name = specifier.slice('@agentdev/'.length);
        if (SOURCE_PACKAGES.includes(name)) {
          const entry = join(REPO_ROOT, 'packages', name, 'src', 'index.ts');
          return { url: pathToFileURL(entry).href, shortCircuit: true };
        }
      }
      const parent = context.parentURL ?? '';
      if (
        (specifier.startsWith('./') || specifier.startsWith('../')) &&
        parent.endsWith('.ts') &&
        specifier.endsWith('.js')
      ) {
        const candidate = new URL(specifier.replace(/\.js$/u, '.ts'), parent);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
      return nextResolve(specifier, context);
    },
  });
}

/**
 * Imports the real product modules the runner drives.
 *
 * The dynamic imports happen after the resolver is installed, so every module in
 * the graph (Core, Storage, Workspace, Knowledge, the daemon and the BFF) is the
 * repository's own current source.
 */
export async function loadProduct() {
  installSourceResolver();
  const [
    contracts,
    storage,
    workspace,
    knowledge,
    domain,
    core,
    daemon,
    daemonProtocol,
    web,
    client,
  ] = await Promise.all([
    import('@agentdev/contracts'),
    import('@agentdev/storage'),
    import('@agentdev/workspace'),
    import('@agentdev/knowledge'),
    import('@agentdev/domain'),
    import('@agentdev/core'),
    import('../../apps/daemon/src/index.ts'),
    // `apps/daemon/src/index.ts` re-exports only `server.js`; the BFF talks to the
    // workbench protocol, so the drill imports it explicitly.
    import('../../apps/daemon/src/protocol.ts'),
    import('../../apps/web/src/index.ts'),
    import('@agentdev/client'),
  ]);
  return {
    contracts,
    storage,
    workspace,
    knowledge,
    domain,
    core,
    daemon,
    daemonProtocol,
    web,
    client,
  };
}

// ---------------------------------------------------------------------------
// Temporary projects and Git
// ---------------------------------------------------------------------------

/** Creates one real temporary directory that {@link cleanupTempDirs} later removes. */
const temporaryDirs = [];

export function makeTempDir(prefix = 'agentdev-e2e-') {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  temporaryDirs.push(dir);
  return dir;
}

export function cleanupTempDirs() {
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir === undefined) continue;
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Writes one file (creating parent directories) into a temporary project. */
export function writeFileAt(root, relativePath, content) {
  const absolute = join(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

/**
 * Runs `git` in a directory and returns stdout, throwing with Git's own message.
 *
 * The runner configures the repository's own `user.name`/`user.email`, so the
 * temporary project commits under a deterministic identity and never reads (or
 * writes) the machine's global Git configuration.
 */
export function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_AUTHOR_NAME: 'AgentDev E2E',
        GIT_AUTHOR_EMAIL: 'e2e@agentdev.local',
        GIT_COMMITTER_NAME: 'AgentDev E2E',
        GIT_COMMITTER_EMAIL: 'e2e@agentdev.local',
      },
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${details}`, { cause: error });
  }
}

/**
 * Creates a real Git repository with a seed commit on a `agentdev/main` branch.
 *
 * The branch name is the Product's delivery branch (`ARCHITECTURE.md` §4), so the
 * Project row, the save service and the settlement service all operate on the same
 * real ref instead of a test-only convention.
 */
export function initRepository(root, options = {}) {
  const branch = options.branch ?? 'agentdev/main';
  const files = options.files ?? { 'README.md': '# e2e project\n' };
  git(['init', '--quiet', '--initial-branch', branch], root);
  writeFileAt(root, '.gitignore', 'node_modules/\n.agentdev/work/\n');
  for (const [path, content] of Object.entries(files)) writeFileAt(root, path, content);
  git(['add', '--all'], root);
  git(['commit', '--quiet', '-m', options.message ?? 'chore: seed the e2e project'], root);
  return git(['rev-parse', 'HEAD'], root).trim();
}

/** The current revision of a ref, or the empty string when the ref does not exist. */
export function revisionOf(cwd, ref = 'HEAD') {
  try {
    return git(['rev-parse', ref], cwd).trim();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * One HTTP request over `node:http`; resolves with status, headers and text body.
 *
 * `fetch` is deliberately not used: the runner must work with the plain-JavaScript
 * tooling globals ESLint applies to `scripts/`, and it must keep a single transport
 * for both the plain requests and the WebSocket upgrade below.
 */
export function httpRequest(url, options = {}) {
  const method = options.method ?? 'GET';
  const body = options.body;
  const headers = { ...(options.headers ?? {}) };
  if (body !== undefined && headers['content-length'] === undefined) {
    headers['content-length'] = String(Buffer.byteLength(body));
  }
  const timeoutMs = options.timeoutMs ?? 15_000;
  return new Promise((resolvePromise, reject) => {
    const target = new URL(url);
    const req = httpRequestBase(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolvePromise({
            status: response.statusCode ?? 0,
            headers: response.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request to ${url} timed out`)));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Parses a JSON response body, failing loudly with the raw text when it is not JSON. */
export function jsonOf(response) {
  try {
    return JSON.parse(response.text);
  } catch {
    throw new Error(`expected JSON but got (${response.status}): ${response.text.slice(0, 400)}`);
  }
}

/** The `set-cookie` header values of a response, as a plain array. */
export function setCookies(response) {
  const raw = response.headers['set-cookie'];
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/** The `name=value` pair of one `set-cookie` header, or `undefined`. */
export function cookiePair(response, name) {
  for (const header of setCookies(response)) {
    const pair = header.split(';')[0] ?? '';
    if (pair.startsWith(`${name}=`)) return pair;
  }
  return undefined;
}

/** Builds a `multipart/form-data` body the daemon's own parser accepts. */
export function multipartBody(fields, file) {
  const boundary = `----agentdev-e2e-${randomBytes(8).toString('hex')}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        'utf8',
      ),
    );
  }
  if (file !== undefined) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${file.filename}"\r\ncontent-type: ${file.mime}\r\n\r\n`,
        'utf8',
      ),
      Buffer.from(file.bytes),
      Buffer.from('\r\n', 'utf8'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat(parts) };
}

// ---------------------------------------------------------------------------
// WebSocket (client side of the product's RFC6455 subset)
// ---------------------------------------------------------------------------

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** Encodes one masked client frame (clients must mask; both product codecs assume it). */
export function encodeClientFrame(opcode, payload) {
  const mask = randomBytes(4);
  const header = [0x80 | opcode];
  if (payload.byteLength < 126) header.push(0x80 | payload.byteLength);
  else if (payload.byteLength < 65_536) {
    header.push(0x80 | 126, (payload.byteLength >> 8) & 0xff, payload.byteLength & 0xff);
  } else {
    header.push(
      0x80 | 127,
      0,
      0,
      0,
      0,
      (payload.byteLength >>> 24) & 0xff,
      (payload.byteLength >>> 16) & 0xff,
      (payload.byteLength >>> 8) & 0xff,
      payload.byteLength & 0xff,
    );
  }
  const masked = Buffer.allocUnsafe(payload.byteLength);
  for (let index = 0; index < payload.byteLength; index += 1) {
    masked[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
  }
  return Buffer.concat([Buffer.from(header), mask, masked]);
}

/** Decodes one unmasked server frame from the front of `buffer`. */
export function decodeServerFrame(buffer) {
  if (buffer.byteLength < 2) return undefined;
  const first = buffer[0] ?? 0;
  const second = buffer[1] ?? 0;
  if ((first & 0x80) === 0) throw new Error('fragmented server frames are not supported');
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.byteLength < 4) return undefined;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.byteLength < 10) return undefined;
    if (buffer.readUInt32BE(2) !== 0) throw new Error('server frame is too large');
    length = buffer.readUInt32BE(6);
    offset = 10;
  }
  if (length > MAX_FRAME_BYTES) throw new Error('server frame is too large');
  const maskLength = masked ? 4 : 0;
  if (buffer.byteLength < offset + maskLength + length) return undefined;
  const mask = masked ? buffer.subarray(offset, offset + 4) : undefined;
  const start = offset + maskLength;
  const payload = Buffer.allocUnsafe(length);
  for (let index = 0; index < length; index += 1) {
    const byte = buffer[start + index] ?? 0;
    payload[index] = mask === undefined ? byte : byte ^ (mask[index % 4] ?? 0);
  }
  return { opcode, payload, consumed: start + length };
}

/**
 * A minimal WebSocket client: the browser side of the product's own subset.
 *
 * It performs the real upgrade over `node:http`, masks its frames (as a browser
 * must), answers pings and records every JSON frame it receives so a check can wait
 * for a specific event, `batch_end` watermark or `bridge.*` transition.
 */
export class WsClient {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.frames = [];
    this.waiters = [];
    this.closed = false;
    this.closeInfo = null;
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('close', () => this.onClose());
    socket.on('error', () => this.onClose());
  }

  /** Opens a real WebSocket to `url` with the given handshake headers. */
  static connect(url, headers = {}) {
    const target = new URL(url);
    const key = randomBytes(16).toString('base64');
    return new Promise((resolvePromise, reject) => {
      const req = httpRequestBase({
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers: {
          ...headers,
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-key': key,
          'sec-websocket-version': '13',
        },
      });
      req.on('upgrade', (response, socket, head) => {
        const expected = createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
        if (response.headers['sec-websocket-accept'] !== expected) {
          socket.destroy();
          reject(new Error('the WebSocket handshake did not return the expected accept key'));
          return;
        }
        const client = new WsClient(socket);
        if (head.byteLength > 0) client.onData(head);
        resolvePromise(client);
      });
      req.on('response', (response) => {
        reject(
          new Error(
            `the WebSocket upgrade was refused with ${String(response.statusCode)} (x-agentdev-reason: ${String(response.headers['x-agentdev-reason'] ?? 'none')})`,
          ),
        );
      });
      req.on('error', reject);
      req.end();
    });
  }

  /** Sends one JSON frame as a masked text frame. */
  send(value) {
    this.socket.write(encodeClientFrame(0x1, Buffer.from(JSON.stringify(value), 'utf8')));
  }

  /** Resolves with the first already-received or future frame matching `predicate`. */
  waitFor(predicate, options = {}) {
    const label = options.label ?? 'frame';
    const timeoutMs = options.timeoutMs ?? 10_000;
    const existing = this.frames.find((frame) => predicate(frame));
    if (existing !== undefined) return Promise.resolve(existing);
    return new Promise((resolvePromise, reject) => {
      const waiter = { predicate, resolve: resolvePromise, reject };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((entry) => entry !== waiter);
        reject(
          new Error(
            `timed out after ${String(timeoutMs)}ms waiting for ${label}; received: ${JSON.stringify(this.frames).slice(0, 800)}`,
          ),
        );
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  /** Closes the socket; the peer sees a normal 1000 closure. */
  close() {
    if (this.closed) return;
    this.socket.write(encodeClientFrame(0x8, Buffer.from([0x03, 0xe8])));
    this.socket.end();
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      let decoded;
      try {
        decoded = decodeServerFrame(this.buffer);
      } catch (error) {
        this.closeInfo = { code: 1002, reason: String(error) };
        this.socket.destroy();
        return;
      }
      if (decoded === undefined) return;
      this.buffer = this.buffer.subarray(decoded.consumed);
      if (decoded.opcode === 0x8) {
        const code = decoded.payload.byteLength >= 2 ? decoded.payload.readUInt16BE(0) : 1005;
        this.closeInfo = { code, reason: decoded.payload.subarray(2).toString('utf8') };
        this.socket.end();
        return;
      }
      if (decoded.opcode === 0x9) {
        this.socket.write(encodeClientFrame(0xa, decoded.payload));
        continue;
      }
      if (decoded.opcode !== 0x1) continue;
      let frame;
      try {
        frame = JSON.parse(decoded.payload.toString('utf8'));
      } catch {
        continue;
      }
      this.frames.push(frame);
      for (const waiter of [...this.waiters]) {
        if (!waiter.predicate(frame)) continue;
        this.waiters = this.waiters.filter((entry) => entry !== waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(frame);
      }
    }
  }

  onClose() {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(
        new Error(
          `the WebSocket closed before the awaited frame arrived (code ${String(this.closeInfo?.code ?? 'unknown')})`,
        ),
      );
    }
    this.waiters = [];
  }
}

/** Waits for `ms`; used to observe idle windows (event batching, lease expiry). */
export function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}
