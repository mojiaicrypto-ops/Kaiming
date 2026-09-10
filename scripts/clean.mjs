#!/usr/bin/env node
/**
 * Removes build outputs recorded in tsconfig layouts.
 */
import { rm } from 'node:fs/promises';
import { globSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const targets = [
  ...globSync('packages/*/dist', { cwd: root }),
  ...globSync('apps/*/dist', { cwd: root }),
  ...globSync('*.tsbuildinfo', { cwd: root }),
  ...globSync('packages/*/*.tsbuildinfo', { cwd: root }),
  ...globSync('apps/*/*.tsbuildinfo', { cwd: root }),
];

for (const target of targets) {
  await rm(join(root, target), { recursive: true, force: true });
}
process.stdout.write(`removed ${targets.length} build output path(s)\n`);
