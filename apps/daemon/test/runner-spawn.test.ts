/**
 * The spawn-side contract of `apps/daemon/src/runner-spawn.ts`.
 *
 * Three properties are asserted here because they are easy to break silently and expensive to
 * debug in production:
 *
 * - the child's environment is an **allowlist**, never the daemon's whole environment
 *   (`execution.md` §2: the Provider secret stays in the Core);
 * - a diagnostic line never prints a value that is not on the observable-flag list, so the
 *   capability can never leak through `argv` logging;
 * - the container image reference a launcher exports reaches the Runner, so
 *   `environmentRef` names the real image instead of `container:undeclared`.
 */
import { describe, expect, it } from 'vitest';
import { RUNNER_ENV_ALLOWLIST, redactRunnerArgv, runnerChildEnv } from '../src/runner-spawn.js';

describe('runner-spawn environment', () => {
  it('keeps the process basics and the container image, and drops every credential', () => {
    const env = runnerChildEnv({
      PATH: '/usr/bin',
      HOME: '/home/agentdev',
      TMPDIR: '/tmp',
      AGENTDEV_EXEC_IMAGE: 'agentdev/exec:0.0.0',
      AGENTDEV_PROVIDER_SECRET: 'sk-do-not-leak',
      AGENTDEV_PROVIDER_BASE_URL: 'https://api.example.test',
      NODE_OPTIONS: '--require ./inject.cjs',
      VITEST: 'true',
    });
    expect(env).toMatchObject({
      PATH: '/usr/bin',
      HOME: '/home/agentdev',
      TMPDIR: '/tmp',
      AGENTDEV_EXEC_IMAGE: 'agentdev/exec:0.0.0',
    });
    expect(env['AGENTDEV_PROVIDER_SECRET']).toBeUndefined();
    expect(env['AGENTDEV_PROVIDER_BASE_URL']).toBeUndefined();
    // `NODE_OPTIONS` is a code-injection channel: `--require` runs before any product code.
    expect(env['NODE_OPTIONS']).toBeUndefined();
    expect(env['VITEST']).toBeUndefined();
    expect(Object.keys(env).every((name) => RUNNER_ENV_ALLOWLIST.includes(name))).toBe(true);
  });

  it('names the image only when a launcher exported one', () => {
    expect(runnerChildEnv({ AGENTDEV_EXEC_IMAGE: '' })['AGENTDEV_EXEC_IMAGE']).toBe('');
    expect(runnerChildEnv({})['AGENTDEV_EXEC_IMAGE']).toBeUndefined();
  });
});

describe('redactRunnerArgv', () => {
  it('prints the configuration flags and redacts every other value', () => {
    const rendered = redactRunnerArgv([
      '/repo/apps/runner/dist/cli.js',
      '--attempt-id',
      'attempt-1',
      '--tools',
      'read,edit',
      '--models-path',
      '/tmp/models.json',
      '--control-url',
      'http://127.0.0.1:1234',
      '--system-prompt',
      'a very long system prompt',
    ]);
    expect(rendered).toEqual([
      '/repo/apps/runner/dist/cli.js',
      '--attempt-id',
      'attempt-1',
      '--tools',
      'read,edit',
      '--models-path',
      '/tmp/models.json',
      '--control-url',
      'http://127.0.0.1:1234',
      '--system-prompt',
      `<redacted:${String('a very long system prompt'.length)}>`,
    ]);
    expect(rendered.join(' ')).not.toContain('a very long system prompt');
  });

  it('keeps a boolean flag from swallowing the next flag as its value', () => {
    expect(redactRunnerArgv(['--self-check', '--role', 'chief'])).toEqual([
      '--self-check',
      '--role',
      'chief',
    ]);
  });

  it('shows a blank value as blank instead of hiding it', () => {
    expect(redactRunnerArgv(['--tools', '', '--role', 'chief'])).toEqual([
      '--tools',
      '',
      '--role',
      'chief',
    ]);
  });
});
