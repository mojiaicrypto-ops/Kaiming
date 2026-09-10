/**
 * ESLint-only preload: serves the TypeScript 6 compiler API to typescript-eslint.
 *
 * TypeScript 7 is the native port and no longer ships the JavaScript compiler
 * API, so `typescript-eslint@8.70.0` refuses to load against it (its supported
 * range is `>=4.8.4 <6.1.0`). The product pins `typescript@7.0.2` for
 * `typecheck`/`build`; for linting we hand the linter the supported API from the
 * `typescript-lint` alias (TypeScript 6.0.3) instead.
 *
 * The redirect is scoped to the lint process: `pnpm lint` sets NODE_OPTIONS so
 * only ESLint sees it, and `tsc` keeps running TypeScript 7.
 */
const Module = require('node:module');

const LINT_TYPESCRIPT = 'typescript-lint';
const original = Module._resolveFilename;

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request === 'typescript' || request.startsWith('typescript/')) {
    // Subpaths matter: typescript-eslint's project service imports
    // `typescript/lib/tsserverlibrary` directly.
    return original.call(
      this,
      request.replace(/^typescript/, LINT_TYPESCRIPT),
      parent,
      isMain,
      options,
    );
  }
  return original.call(this, request, parent, isMain, options);
};
