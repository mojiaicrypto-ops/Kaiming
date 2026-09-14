/**
 * WP-12 T4b: the daemon's `ui.translate` catalogue covers the keys the WebUI asks for.
 *
 * `docs/architecture/protocol.md` §5 and `experience.md` §6 fix the en/简体 catalogue;
 * the audit (`api-gap-audit.md` §2.5) found the daemon answered `NOT_FOUND` for most of
 * the keys the pages and the client script render. This test derives the used-key set
 * from the real sources instead of a hand-maintained list, so a new `data-i18n` key
 * cannot silently fall back to the client dictionary again.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UI_STRINGS as WORKBENCH_STRINGS } from '@agentdev/web';
import { WorkbenchServicesStrings } from '../src/protocol.js';

/** The interface keys the pages and the client script actually ask for. */
function usedKeys(): string[] {
  const files = [
    'apps/web/public/app.js',
    ...readdirSync('apps/web/src')
      .filter((name) => name.endsWith('.ts') && name !== 'i18n.ts')
      .map((name) => join('apps/web/src', name)),
  ];
  const keys = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bt\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      keys.add(match[1] as string);
    }
    for (const match of source.matchAll(/data-i18n(?:-aria)?=["']([A-Za-z][\w.:-]*)["']/g)) {
      keys.add(match[1] as string);
    }
  }
  // The client fetches these unconditionally so a refused Plan approval is localised
  // (`public/app.js` `loadStrings`, W9R2-05).
  for (const key of [
    'detail.approveReason.no_plan',
    'detail.approveReason.stale_version',
    'detail.approveReason.gate_not_approved',
    'detail.approveReason.plan_unreadable',
    'detail.approveReason.no_authorization',
    'detail.approveReason.authorization_unreadable',
    'detail.approveReason.gate_unavailable',
    'detail.approveExpired',
    'detail.approveUnavailable',
  ]) {
    keys.add(key);
  }
  return [...keys].sort();
}

describe('daemon ui.translate catalogue (WP-12 T4b)', () => {
  it('answers every interface key the WebUI renders', () => {
    const keys = usedKeys();
    expect(keys.length).toBeGreaterThan(100);
    const missing = keys.filter((key) => WorkbenchServicesStrings[key] === undefined);
    expect(missing).toEqual([]);
  });

  it('keeps the en/zh shape and matches the workbench wording word for word', () => {
    for (const [key, value] of Object.entries(WorkbenchServicesStrings)) {
      expect(typeof value.en).toBe('string');
      expect(typeof value.zh).toBe('string');
      expect(value.en.length).toBeGreaterThan(0);
      expect(value.zh.length).toBeGreaterThan(0);
      const workbench = WORKBENCH_STRINGS[key];
      if (workbench !== undefined) {
        expect(value).toEqual({ en: workbench.en, zh: workbench.zh });
      }
    }
  });

  it('never carries a project-content key', () => {
    // Project content is never translated (`experience.md` §6); the catalogue holds
    // interface identifiers only, never message/artifact text.
    for (const key of Object.keys(WorkbenchServicesStrings)) {
      expect(key).toMatch(/^[a-zA-Z][\w.-]*$/);
    }
  });
});
