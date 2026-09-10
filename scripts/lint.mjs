#!/usr/bin/env node
/**
 * `pnpm lint` — ESLint with type-aware rules, then Prettier's format check.
 *
 * Running ESLint through this script (instead of directly) is what lets the
 * linter use the TypeScript 6 API that typescript-eslint supports while the
 * rest of the toolchain stays on the pinned TypeScript 7 — see
 * `scripts/typescript-6-preload.cjs`.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bin = (name) => join(root, 'node_modules', '.bin', name);

function run(command, args, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (error) => {
      process.stderr.write(`${command}: ${error.message}\n`);
      resolve(1);
    });
  });
}

const preload = `--require=${join(root, 'scripts', 'typescript-6-preload.cjs')}`;
const nodeOptions = [process.env.NODE_OPTIONS, preload].filter(Boolean).join(' ');

const eslintCode = await run(bin('eslint'), ['.'], {
  ...process.env,
  NODE_OPTIONS: nodeOptions,
});
if (eslintCode !== 0) process.exit(eslintCode);

process.exit(await run(bin('prettier'), ['--check', '.']));
