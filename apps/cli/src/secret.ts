/**
 * `agentdev secret` — the credential entry point (WP-12 T1.1).
 *
 * `docs/architecture/execution.md` §4 keeps the durable copy outside the product
 * database: macOS Keychain or a 0600 encrypted file under the installation home. The CLI
 * is the documented way to put a value *into* it, and three rules shape this module:
 *
 * 1. **The value comes from stdin only.** `agentdev secret set <ref>` never accepts the
 *    value as an argument, so it cannot land in `ps`, shell history or a process title;
 *    nothing here echoes it either (`execution.md` §4: "输出不含认证Header").
 * 2. **Live daemon first.** When `runtime.json` names a daemon that really answers, the
 *    write goes through its loopback admin surface (`POST`/`DELETE /secret`), so the
 *    running process registers the credential immediately instead of waiting for a
 *    restart. Otherwise — the documented `agentdev start` is simply not running — the
 *    CLI writes the same repository directly, and says which path it took on stdout.
 * 3. **Honest failures.** Every failure prints the stable error code plus an
 *    `operationId`, exactly like the other runtime commands (`reliability.md` §7).
 */
import { randomUUID } from 'node:crypto';

import type { RuntimeRecord } from '@agentdev/contracts';
import type { SecretRepository } from '@agentdev/core';
import type * as CoreModule from '@agentdev/core';

import { adminRequest, waitForRuntime, type CliRuntimeRecord } from './runtime.js';

export interface SecretCommandIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  /** Reads the whole value from stdin; injected by tests, never from argv. */
  readonly readStdin: () => Promise<string>;
}

export interface SecretCommandInput {
  readonly rest: readonly string[];
  readonly home: string;
  readonly io: SecretCommandIo;
}

/** Reads every byte of stdin as UTF-8; the CLI's only source of a secret value. */
export async function readStdinValue(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** Strips the one line terminator a here-doc or `echo` adds; keeps every other byte. */
export function normaliseStdinValue(raw: string): string {
  if (raw.endsWith('\r\n')) return raw.slice(0, -2);
  if (raw.endsWith('\n')) return raw.slice(0, -1);
  return raw;
}

/** Implements `agentdev secret set|list|delete`. */
export async function runSecretCommand(input: SecretCommandInput): Promise<number> {
  const { rest, home, io } = input;
  const [action, ...args] = rest;
  const fail = (code: string, message: string): number => {
    io.err(
      `${JSON.stringify({ ok: false, error: { code, message }, operationId: randomUUID() })}\n`,
    );
    return 1;
  };
  const print = (value: unknown): void => {
    io.out(`${JSON.stringify(value, null, 2)}\n`);
  };

  if (action === 'list') {
    if (args.length > 0) return fail('VALIDATION_ERROR', 'secret list takes no arguments');
    // The query surface is the repository itself: it is the authority `list` needs and
    // no admin read route exists (`POST`/`DELETE /secret` are write routes).
    const opened = await openRepository(home);
    if (!opened.ok) return fail(opened.code, opened.message);
    try {
      print({
        ok: true,
        path: 'repository',
        backend: opened.repository.backend,
        items: opened.repository.list(),
        // Files the backend could not treat as records; they hold no value, and the
        // command stays successful so a stray file never hides the readable refs.
        problems: opened.repository.problems(),
      });
      return 0;
    } catch (error) {
      return fail(errorCode(error, 'SECRET_LIST_FAILED'), errorMessage(error));
    }
  }

  if (action === 'delete') {
    const ref = args[0];
    if (ref === undefined || ref.length === 0) {
      return fail('VALIDATION_ERROR', 'secret delete requires a ref');
    }
    if (args.length > 1) return fail('VALIDATION_ERROR', 'secret delete takes one ref');
    const live = await liveAdmin(home);
    if (live.status === 'unreadable') return fail('RUNTIME_RECORD_INVALID', live.message);
    if (live.status === 'running') {
      try {
        const response = await adminRequest(home, live.record.admin, 'DELETE', '/secret', { ref });
        if (response.status === 200) {
          print({ ok: true, path: 'daemon', ref, deleted: true });
          return 0;
        }
        return fail(
          errorCodeOf(response.body, 'SECRET_DELETE_FAILED'),
          errorMessageOf(response.body),
        );
      } catch (error) {
        return fail('SECRET_ADMIN_UNREACHABLE', errorMessage(error));
      }
    }
    const opened = await openRepository(home);
    if (!opened.ok) return fail(opened.code, opened.message);
    try {
      const deleted = opened.repository.delete(ref);
      print({ ok: true, path: 'repository', ref, deleted });
      return 0;
    } catch (error) {
      return fail(errorCode(error, 'SECRET_DELETE_FAILED'), errorMessage(error));
    }
  }

  if (action === 'set') {
    const ref = args[0];
    if (ref === undefined || ref.length === 0) {
      return fail('VALIDATION_ERROR', 'secret set requires a ref and reads the value from stdin');
    }
    const audience = audienceOf(args.slice(1));
    if (typeof audience !== 'string') return fail('VALIDATION_ERROR', audience.message);
    const value = normaliseStdinValue(await io.readStdin());
    if (value.length === 0) {
      return fail('VALIDATION_ERROR', 'the secret value read from stdin is empty');
    }
    const live = await liveAdmin(home);
    if (live.status === 'unreadable') return fail('RUNTIME_RECORD_INVALID', live.message);
    if (live.status === 'running') {
      try {
        const response = await adminRequest(home, live.record.admin, 'POST', '/secret', {
          ref,
          value,
          audience,
        });
        if (response.status === 200) {
          const secret = (response.body as { secret?: { updatedAt?: unknown; backend?: unknown } })
            .secret;
          print({
            ok: true,
            path: 'daemon',
            backend: typeof secret?.backend === 'string' ? secret.backend : null,
            ref,
            configured: true,
            updatedAt: typeof secret?.updatedAt === 'string' ? secret.updatedAt : null,
          });
          return 0;
        }
        // The daemon path masks the value too (WP-12 review P3): the defence must not
        // depend on which route the command took.
        return fail(
          errorCodeOf(response.body, 'SECRET_SET_FAILED'),
          await maskValue(errorMessageOf(response.body), value),
        );
      } catch (error) {
        return fail('SECRET_ADMIN_UNREACHABLE', await maskValue(errorMessage(error), value));
      }
    }
    const opened = await openRepository(home);
    if (!opened.ok) return fail(opened.code, opened.message);
    try {
      const summary = opened.repository.set(ref, value, { audience });
      print({
        ok: true,
        path: 'repository',
        backend: summary.backend,
        ref: summary.ref,
        configured: summary.configured,
        updatedAt: summary.updatedAt,
      });
      return 0;
    } catch (error) {
      // Mask with Core's own helper: no failure may print the value (`execution.md` §4).
      return fail(
        errorCode(error, 'SECRET_SET_FAILED'),
        opened.redact(errorMessage(error), [value]),
      );
    }
  }

  if (action === 'rotate') {
    const ref = args[0];
    if (ref === undefined || ref.length === 0) {
      return fail(
        'VALIDATION_ERROR',
        'secret rotate requires an existing ref and reads the new value from stdin',
      );
    }
    const audience = audienceOf(args.slice(1));
    if (typeof audience !== 'string') return fail('VALIDATION_ERROR', audience.message);
    const value = normaliseStdinValue(await io.readStdin());
    if (value.length === 0) {
      return fail('VALIDATION_ERROR', 'the secret value read from stdin is empty');
    }
    // Rotation replaces an existing credential; a first registration is `set`, so an unknown
    // ref fails instead of silently creating one.
    const opened = await openRepository(home);
    if (!opened.ok) return fail(opened.code, opened.message);
    const existing = opened.repository.list().find((entry) => entry.ref === ref);
    if (existing === undefined) {
      return fail(
        'SECRET_NOT_FOUND',
        `没有已注册的凭证 ${ref}；首次录入请用 agentdev secret set ${ref}`,
      );
    }

    const live = await liveAdmin(home);
    if (live.status === 'unreadable') return fail('RUNTIME_RECORD_INVALID', live.message);
    let updatedAt: string | null = existing.updatedAt;
    let backend: string | null = existing.backend;
    let path: 'daemon' | 'repository' = 'repository';
    if (live.status === 'running') {
      // A live daemon owns the in-memory store the Gateway resolves against, so the write
      // goes through its admin surface and takes effect for the next call immediately.
      try {
        const response = await adminRequest(home, live.record.admin, 'POST', '/secret', {
          ref,
          value,
          audience,
        });
        if (response.status !== 200) {
          return fail(
            errorCodeOf(response.body, 'SECRET_ROTATE_FAILED'),
            await maskValue(errorMessageOf(response.body), value),
          );
        }
        const secret = (response.body as { secret?: { updatedAt?: unknown; backend?: unknown } })
          .secret;
        path = 'daemon';
        if (typeof secret?.updatedAt === 'string') updatedAt = secret.updatedAt;
        if (typeof secret?.backend === 'string') backend = secret.backend;
      } catch (error) {
        return fail('SECRET_ADMIN_UNREACHABLE', await maskValue(errorMessage(error), value));
      }
    } else {
      try {
        const summary = opened.repository.set(ref, value, { audience });
        updatedAt = summary.updatedAt;
        backend = summary.backend;
      } catch (error) {
        return fail(
          errorCode(error, 'SECRET_ROTATE_FAILED'),
          opened.redact(errorMessage(error), [value]),
        );
      }
    }
    print({
      ok: true,
      command: 'secret rotate',
      path,
      ref,
      backend,
      rotated: true,
      previousUpdatedAt: existing.updatedAt,
      updatedAt,
      // The replacement is one atomic file write (tmp + rename) or one admin POST.
      atomicSwap: true,
      affected: {
        secretRef: ref,
        providers: providerReferences(opened.core, home, ref),
      },
      // Honest scope: a rotation changes what the next gateway call resolves. It does not and
      // cannot revoke a capability that was already issued.
      capabilities: {
        revoked: 0,
        note: 'rotate 只替换凭证值：下一次 gateway 调用即解析到新值（daemon 运行时经 POST /secret 立即生效，否则下次 start 装载）。已签发的短期 attempt capability 与冻结的 ConfigSnapshot 不会被撤销，也不会改指其它 ref；需要立即阻断请禁用 Provider 或 agentdev secret delete <ref>',
      },
    });
    return 0;
  }

  return fail(
    'VALIDATION_ERROR',
    'usage: agentdev secret set <ref> [--stdin] [--audience gateway|tool] | secret rotate <ref> [--audience gateway|tool] | secret list | secret delete <ref>',
  );
}

/**
 * Providers whose `secretRef` is this ref, so a rotation says what it affects.
 *
 * Only identifiers and model ids are reported; the credential value never appears.
 */
function providerReferences(
  core: typeof CoreModule,
  home: string,
  ref: string,
): readonly { readonly providerId: string; readonly models: readonly string[] }[] {
  try {
    const config = core.ConfigStore.open({ globalDir: home });
    return config
      .global()
      .providers.filter((provider) => provider.secretRef === ref)
      .map((provider) => ({
        providerId: provider.providerId,
        models: provider.models.map((model) => model.id),
      }));
  } catch {
    // A broken configuration is reported by `config.get`; it must not turn a rotation into
    // a failure after the value was already replaced.
    return [];
  }
}

/**
 * Masks one value out of failure text.
 *
 * Core's `redact` is the single mask implementation; the CLI loads it lazily (as it does
 * the repository) and falls back to leaving the text alone, which never adds a value.
 */
async function maskValue(text: string, value: string): Promise<string> {
  try {
    const core = await import('@agentdev/core');
    return core.redact(text, [value]);
  } catch {
    return text;
  }
}

type LiveAdmin =
  | { readonly status: 'running'; readonly record: RuntimeRecord }
  | { readonly status: 'stopped' }
  | { readonly status: 'unreadable'; readonly message: string };

/** Resolves the live daemon, or reports that nothing answers on the recorded port. */
async function liveAdmin(home: string): Promise<LiveAdmin> {
  let live: CliRuntimeRecord | null;
  try {
    live = await waitForRuntime(home, { timeoutMs: 0 });
  } catch (error) {
    // A malformed `runtime.json` must not silently turn into a direct write: `status`
    // reports it, and here it is safer to fail than to guess.
    return { status: 'unreadable', message: errorMessage(error) };
  }
  return live === null ? { status: 'stopped' } : { status: 'running', record: live.record };
}

type OpenRepository =
  | {
      readonly ok: true;
      readonly repository: SecretRepository;
      /** Core's `redact`: masks the value out of any failure text (WP-12 T1.1). */
      readonly redact: (text: string, knownSecrets: readonly string[]) => string;
      /** The loaded Core module, so `rotate` can read the Provider references it affects. */
      readonly core: typeof CoreModule;
    }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** Loads the durable repository lazily, so `doctor`/`start` never pull in Core. */
async function openRepository(home: string): Promise<OpenRepository> {
  try {
    const core = await import('@agentdev/core');
    return {
      ok: true,
      repository: core.createSecretRepository({ home }),
      redact: core.redact,
      core,
    };
  } catch (error) {
    return {
      ok: false,
      code: errorCode(error, 'SECRET_STORE_UNAVAILABLE'),
      message: errorMessage(error),
    };
  }
}

/** Parses the optional `--audience` flag; defaults to the documented `gateway`. */
function audienceOf(args: readonly string[]): 'gateway' | 'tool' | { message: string } {
  let audience: 'gateway' | 'tool' = 'gateway';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--audience') {
      const value = args[index + 1];
      if (value !== 'gateway' && value !== 'tool') {
        return { message: '--audience must be "gateway" or "tool"' };
      }
      audience = value;
      index += 1;
      continue;
    }
    if (arg === '--stdin') {
      // `plan.md` §4 T1 documents `secret set <ref> [--stdin]`. Reading stdin is the only
      // value source either way, so the flag is accepted as an explicit no-op rather
      // than rejected as an unknown option (WP-12 review P3).
      continue;
    }
    return { message: `unknown option: ${String(arg)}` };
  }
  return audience;
}

function errorCode(error: unknown, fallback: string): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCodeOf(body: unknown, fallback: string): string {
  const code = (body as { error?: { code?: unknown } }).error?.code;
  return typeof code === 'string' ? code : fallback;
}

function errorMessageOf(body: unknown): string {
  const message = (body as { error?: { message?: unknown } }).error?.message;
  return typeof message === 'string' ? message : 'the daemon refused the request';
}
