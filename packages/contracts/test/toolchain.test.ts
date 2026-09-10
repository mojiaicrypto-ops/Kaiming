import { describe, expect, it } from 'vitest';
import {
  ENGINEERING_COMMANDS,
  NODE_MINIMUM,
  PACKAGE_MANAGER,
  PINNED_DEPENDENCIES,
  satisfiesMinimum,
  versionEquals,
} from '../src/index.js';

describe('pinned toolchain', () => {
  it('matches the documented dependency versions', () => {
    expect(PINNED_DEPENDENCIES.typescript).toBe('7.0.2');
    expect(PINNED_DEPENDENCIES.react).toBe('19.3.0');
    expect(PINNED_DEPENDENCIES.vite).toBe('8.2.2');
    expect(PINNED_DEPENDENCIES.fastify).toBe('5.12.3');
    expect(PINNED_DEPENDENCIES['better-sqlite3']).toBe('13.0.3');
    expect(PINNED_DEPENDENCIES.ws).toBe('8.21.3');
    expect(PINNED_DEPENDENCIES.zod).toBe('4.5.4');
    expect(PINNED_DEPENDENCIES['@earendil-works/pi-coding-agent']).toBe('0.85.1');
    expect(PINNED_DEPENDENCIES.vitest).toBe('5.0.0');
    expect(PINNED_DEPENDENCIES['@playwright/test']).toBe('1.63.0');
  });

  it('pins Node 24 and pnpm 12.3.4', () => {
    expect(NODE_MINIMUM).toBe('24.0.0');
    expect(PACKAGE_MANAGER).toEqual({ name: 'pnpm', version: '12.3.4' });
  });
});

describe('version comparison', () => {
  it('accepts a runtime at or above the minimum', () => {
    expect(satisfiesMinimum('24.0.0', '24.0.0')).toBe(true);
    expect(satisfiesMinimum('24.8.0', '24.0.0')).toBe(true);
    expect(satisfiesMinimum('25.1.0', '24.0.0')).toBe(true);
    expect(satisfiesMinimum('22.20.2', '24.0.0')).toBe(false);
    expect(satisfiesMinimum('v24.8.0', '24.0.0')).toBe(false);
  });

  it('compares release fields exactly', () => {
    expect(versionEquals('12.3.4', '12.3.4')).toBe(true);
    expect(versionEquals('12.3.40', '12.3.4')).toBe(false);
    expect(versionEquals('12.4.0', '12.3.4')).toBe(false);
    expect(versionEquals('garbage', '12.3.4')).toBe(false);
  });
});

describe('engineering commands', () => {
  it('declares the ten documented commands with an owning work package', () => {
    expect(ENGINEERING_COMMANDS.map((entry) => entry.script)).toEqual([
      'install',
      'typecheck',
      'lint',
      'test:unit',
      'test:integration',
      'test:e2e',
      'test:acceptance',
      'test:live',
      'docs:check',
      'build',
    ]);
    for (const entry of ENGINEERING_COMMANDS) {
      expect(entry.owner, entry.script).toMatch(/^WP-\d{2}$/);
      expect(entry.purpose.length, entry.script).toBeGreaterThan(0);
    }
  });
});
