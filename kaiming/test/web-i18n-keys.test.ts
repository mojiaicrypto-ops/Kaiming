/**
 * The dictionary and the surface must agree: every key the React shell names really exists in both
 * languages, and no key is left over from a screen that no longer exists.
 *
 * Two failure modes are what this guards: a missing key shows `nav.chat` to the user instead of a
 * word, and a dead key keeps copy for a screen nobody can reach.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOG, MESSAGE_KEYS, checkCatalog } from '../webapp/src/i18n/catalog.ts';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Every public method the server registers, read from the server's own source: a hand-kept list
 * let `project.list` look like a missing interface key the moment it was added.
 */
function rpcMethodNames(): Set<string> {
  const serverDir = join(here, '..', 'src', 'server');
  const names = new Set<string>();
  for (const file of readdirSync(serverDir)) {
    if (!file.endsWith('.ts')) continue;
    const text = readFileSync(join(serverDir, file), 'utf8');
    for (const match of text.matchAll(/register\('([a-z]+\.[a-zA-Z.]+)'/g)) {
      const name = match[1];
      if (name !== undefined) names.add(name);
    }
  }
  return names;
}

const RPC_METHODS = rpcMethodNames();
const srcDir = join(here, '..', 'webapp', 'src');

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
    }
  };
  walk(srcDir);
  return out.sort();
}

/** Keys referenced as `t('...')` or via a literal union constant; the catalog itself is skipped. */
function referencedKeys(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles()) {
    if (file.endsWith(join('i18n', 'catalog.ts'))) continue;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'/g)) {
      if (match[1] !== undefined) found.add(match[1]);
    }
    // String literals that look like a catalog key: the same namespaces, but never an RPC method
    // (the API methods share the `project.`/`task.` prefixes; they are not interface text).
    for (const match of text.matchAll(/'((?:nav|chat|task|tool|req|settings|ask|queue|banner|shell|project|auth|toast|common|aria)\.[\w.]+)'/g)) {
      const key = match[1];
      if (key !== undefined && !RPC_METHODS.has(key)) found.add(key);
    }
  }
  return found;
}

describe('interface catalog', () => {
  it('describes exactly the same keys in both languages', () => {
    const diff = checkCatalog();
    expect(diff.missing).toEqual([]);
    expect(diff.extra).toEqual([]);
  });

  it('every key the shell names exists in the catalog', () => {
    const known = new Set<string>(MESSAGE_KEYS);
    const missing = [...referencedKeys()].filter((key) => !known.has(key)).sort();
    expect(missing).toEqual([]);
  });

  it('has no untranslated key: no empty string and no key echoed back as its own text', () => {
    for (const locale of ['en', 'zh-CN'] as const) {
      for (const key of MESSAGE_KEYS) {
        const value = CATALOG[locale][key];
        expect(value.trim(), `${locale}:${key}`).not.toBe('');
        expect(value, `${locale}:${key}`).not.toBe(key);
      }
    }
  });

  it('keeps the placeholder set identical across languages for the same key', () => {
    const placeholders = (value: string): string[] => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();
    for (const key of MESSAGE_KEYS) {
      expect(placeholders(CATALOG['zh-CN'][key]), key).toEqual(placeholders(CATALOG.en[key]));
    }
  });
});
