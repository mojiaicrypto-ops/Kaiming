import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

/**
 * Vitest runs against package sources (never `dist`), so a test run needs no
 * prior build. `tsc -b` stays the authority for emitted declarations.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@agentdev/contracts': fromRoot('packages/contracts/src/index.ts'),
      '@agentdev/pi-runtime': fromRoot('packages/pi-runtime/src/index.ts'),
      '@agentdev/domain': fromRoot('packages/domain/src/index.ts'),
      '@agentdev/storage': fromRoot('packages/storage/src/index.ts'),
      '@agentdev/knowledge': fromRoot('packages/knowledge/src/index.ts'),
      '@agentdev/workspace': fromRoot('packages/workspace/src/index.ts'),
      '@agentdev/core': fromRoot('packages/core/src/index.ts'),
      '@agentdev/client': fromRoot('packages/client/src/index.ts'),
      '@agentdev/web': fromRoot('apps/web/src/index.ts'),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
          exclude: ['**/*.integration.test.ts', '**/node_modules/**', '**/dist/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['**/*.integration.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          testTimeout: 180_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
