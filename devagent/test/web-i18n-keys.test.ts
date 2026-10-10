/**
 * The dictionary and the surface must agree (G4/P4): every key the web code or markup names really
 * exists in both languages, and no shipped key is left over from something that no longer renders.
 *
 * This is the check that keeps the two failure modes honest: a missing key shows the key itself to the
 * user, and a dead key keeps copy for a screen that no longer exists.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '..', 'web');

/** Every file the browser loads, excluding the vendored libraries. */
function webFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'vendor') {
        continue;
      }
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith('.js') || entry.endsWith('.html')) {
        out.push(full);
      }
    }
  };
  walk(webDir);
  return out.sort();
}

describe('web i18n dictionary', () => {
  const dictionary = JSON.parse(readFileSync(join(webDir, 'i18n.json'), 'utf8')) as Record<
    string,
    Record<string, string>
  >;
  const english = dictionary['en'] ?? {};
  const chinese = dictionary['zh-CN'] ?? {};
  const used = new Set<string>();
  /**
   * Every key-shaped literal in the shipped code, wherever it appears. A helper may take the key as
   * an argument (`section('inbox.questions', …)`), so "is this key rendered anywhere" must not depend
   * on the call form - deleting a key the scan cannot see is worse than keeping one it cannot place.
   */
  const literals = new Set<string>();
  /** Prefixes the code builds at runtime (`status.${state}`), which no literal can name. */
  const dynamicPrefixes = new Set<string>();

  for (const file of webFiles()) {
    const source = readFileSync(file, 'utf8');
    for (const [, key] of source.matchAll(/data-i18n(?:-aria|-placeholder)?="([^"]+)"/g)) {
      used.add(key ?? '');
    }
    for (const [, key] of source.matchAll(/\b(?:\.t|\bt|\btr)\(\s*'([^']+)'/g)) {
      used.add(key ?? '');
    }
    for (const [, key] of source.matchAll(/\b(?:\.t|\bt|\btr)\(\s*"([^"]+)"/g)) {
      used.add(key ?? '');
    }
    // Template literals: record the prefix so the dictionary can be checked for at least one entry.
    for (const [, prefix] of source.matchAll(/\b(?:\.t|\bt|\btr)\(\s*`([^`$]*)\$\{/g)) {
      dynamicPrefixes.add(prefix ?? '');
    }
    for (const [, literal] of source.matchAll(/'([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)'/g)) {
      literals.add(literal ?? '');
    }
    for (const [, literal] of source.matchAll(/"([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)"/g)) {
      literals.add(literal ?? '');
    }
  }

  it('resolves every key the web code and markup names', () => {
    const missing = [...used].filter((key) => english[key] === undefined || chinese[key] === undefined);
    expect(missing).toEqual([]);
  });

  it('keeps both languages symmetric and non-empty', () => {
    expect(Object.keys(english).sort()).toEqual(Object.keys(chinese).sort());
    for (const [key, value] of Object.entries(english)) {
      expect({ key, value: value === '' }).toEqual({ key, value: false });
      expect(String(chinese[key]).length).toBeGreaterThan(0);
    }
  });

  it('has an entry for every key prefix the code builds at runtime', () => {
    const prefixes = [...dynamicPrefixes].filter((prefix) => prefix !== '');
    const uncovered = prefixes.filter((prefix) => !Object.keys(english).some((key) => key.startsWith(prefix)));
    expect(uncovered).toEqual([]);
  });

  it('keeps no key that nothing renders any more', () => {
    const dynamic = [...dynamicPrefixes];
    const unused = Object.keys(english).filter(
      (key) => !used.has(key) && !literals.has(key) && !dynamic.some((prefix) => key.startsWith(prefix)),
    );
    expect(unused).toEqual([]);
  });

  it('names only files that exist', () => {
    // A cheap guard that the scan itself is reading the shipped surface, not an empty directory.
    expect(webFiles().length).toBeGreaterThan(5);
  });
});
